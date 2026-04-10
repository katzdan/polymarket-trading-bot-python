/**
 * Order validation module.
 * This module provides validation logic for trades before execution.
 */

import { ethers, BigNumber } from 'ethers';
import { UserPositionInterface } from '../interfaces/User';
import { UserActivityInterface } from '../interfaces/User';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';
import getMyBalance from '../utils/getMyBalance';
import { ErrorHandler } from '../utils/errorHandler';
import { CircuitBreakerRegistry } from '../utils/circuitBreaker';
import { ValidationError } from '../errors';
import { ClobClient } from '@polymarket/clob-client';
import Logger from '../utils/logger';

/** Wallet to validate (follower). Defaults to primary proxy wallet. */
const defaultProxyWallet = () => ENV.PROXY_WALLET;

/**
 * Safely parse a number to BigNumber with fixed decimals, truncating any extra precision
 * to prevent ethers.utils.parseUnits "underflow" errors.
 */
const safeParseUnits = (value: string | number, decimals: number = 6): BigNumber => {
    const s = typeof value === 'number' ? value.toFixed(10) : value;
    const [integer, fractional] = s.split('.');
    if (!fractional) return ethers.utils.parseUnits(integer, decimals);
    const truncatedFractional = fractional.slice(0, decimals);
    return ethers.utils.parseUnits(`${integer}.${truncatedFractional}`, decimals);
};

/**
 * Interface for trade validation results.
 * @interface ValidationResult
 */
interface ValidationResult {
    isValid: boolean;
    reason?: string;
    myPosition?: UserPositionInterface;
    userPosition?: UserPositionInterface;
    myBalance?: number;
    userBalance?: number;
}

/**
 * Validates whether a trade can be executed based on current positions and balances.
 * @param trade - The trade activity to validate.
 * @param userAddress - The address of the user (trader) whose trade is being validated.
 * @param proxyWallet - Optional follower wallet address; if not set, uses ENV.PROXY_WALLET.
 * @param clobClient - Optional CLOB client for fetching order book data.
 */
const validateTrade = async (
    trade: UserActivityInterface,
    userAddress: string,
    proxyWallet?: string,
    clobClient?: ClobClient
): Promise<ValidationResult> => {
    const myWallet = proxyWallet ?? defaultProxyWallet();
    const positionsBreaker = CircuitBreakerRegistry.getBreaker('polymarket-validation-positions', 3, 30000);
    const balanceBreaker = CircuitBreakerRegistry.getBreaker('polymarket-validation-balance', 3, 30000);
    const marketBreaker = CircuitBreakerRegistry.getBreaker('polymarket-market-data', 5, 30000);

    try {
        /**
         * 1. MIN_LEADER_TRADE_USD (Dusting Filter)
         * Rationale: Large whales often execute tiny "noise" trades ($0.10–$50) to test liquidity or "dust" followers.
         * We only want to mirror "high-conviction" moves.
         */
        if (trade.usdcSize < ENV.MIN_LEADER_TRADE_USD) {
            return {
                isValid: false,
                reason: `[SKIP] Trade size below threshold. (Leader traded $${trade.usdcSize.toFixed(2)}, min $${ENV.MIN_LEADER_TRADE_USD})`,
            };
        }

        /**
         * 2. MIN_MARKET_24H_VOL (Liquidity Filter)
         * Rationale: In low-volume markets, even a $5 order can suffer from a wide bid-ask spread.
         * We fetch 24h volume for the specific market to ensure deep liquidity.
         */
        const marketUrl = `https://gamma-api.polymarket.com/markets?limit=1&active=true&closed=false&condition_id=${trade.conditionId}`;
        const marketData = await marketBreaker.execute(() => fetchData(marketUrl));
        
        if (Array.isArray(marketData) && marketData.length > 0) {
            const vol24h = parseFloat(marketData[0].volume24hr || '0');
            if (vol24h < ENV.MIN_MARKET_24H_VOL) {
                return {
                    isValid: false,
                    reason: `[SKIP] Market liquidity insufficient. (24h Vol $${vol24h.toFixed(2)} < $${ENV.MIN_MARKET_24H_VOL})`,
                };
            }

            /**
             * 2b. Wash Trade & Self-Fill Detection (Market Dominance Check)
             * Rationale: If a single trade makes up a vast majority of recent activity, it may be a wash trade.
             */
            const marketDominance = trade.usdcSize / vol24h;
            if (marketDominance > 0.05) { // 5% of 24h volume is a very large single trade
                return {
                    isValid: false,
                    reason: `[SKIP] Potential Wash Trade: Leader volume > 5% of 24h market activity.`,
                };
            }
        }

        /**
         * 3. Order Book Based Checks (MAX_COPY_PRICE and MAX_PRICE_DEVIATION)
         */
        if (clobClient) {
            const orderBook = await clobClient.getOrderBook(trade.asset);
            
            // Use 6 decimals for price comparison consistency (Polymarket standard for USDC/price)
            const leaderPriceBN = safeParseUnits(trade.price, 6);
            const maxCopyPriceBN = safeParseUnits(ENV.MAX_COPY_PRICE, 6);

            if (trade.side === 'BUY') {
                if (orderBook.asks && orderBook.asks.length > 0) {
                    const bestAskPrice = Math.min(...orderBook.asks.map(a => parseFloat(a.price)));
                    const bestAskBN = safeParseUnits(bestAskPrice, 6);
                    
                    /**
                     * 3a. MAX_COPY_PRICE (The "Inverse Bond" Ceiling)
                     * Rationale: Buying at $0.93+ to make $1.00 creates a poor risk-to-reward ratio.
                     */
                    if (bestAskBN.gt(maxCopyPriceBN)) {
                        return {
                            isValid: false,
                            reason: `[SKIP] Price ${bestAskPrice.toFixed(4)} exceeds ${ENV.MAX_COPY_PRICE} ceiling.`,
                        };
                    }

                    /**
                     * 3b. MAX_PRICE_DEVIATION (Slippage Guard)
                     * BigNumber calculation: (bestAsk - leaderPrice) / leaderPrice > threshold
                     * Equivalent to: bestAsk > leaderPrice * (1 + threshold)
                     */
                    const thresholdMultiplierBN = safeParseUnits(1 + ENV.MAX_PRICE_DEVIATION, 6);
                    const maxAllowedPriceBN = leaderPriceBN.mul(thresholdMultiplierBN).div(safeParseUnits(1, 6));
                    
                    if (bestAskBN.gt(maxAllowedPriceBN)) {
                        const deviation = (bestAskPrice - trade.price) / trade.price;
                        return {
                            isValid: false,
                            reason: `[SKIP] Price deviation too high (Slippage). (Current Ask $${bestAskPrice.toFixed(4)} is ${(deviation * 100).toFixed(2)}% > leader's $${trade.price.toFixed(4)})`,
                        };
                    }
                }
            } else if (trade.side === 'SELL') {
                if (orderBook.bids && orderBook.bids.length > 0) {
                    const bestBidPrice = Math.max(...orderBook.bids.map(b => parseFloat(b.price)));
                    const bestBidBN = safeParseUnits(bestBidPrice, 6);
                    
                    /**
                     * MAX_PRICE_DEVIATION (Slippage Guard) for SELL
                     * Equivalent to: bestBid < leaderPrice * (1 - threshold)
                     */
                    const thresholdMultiplierBN = safeParseUnits(1 - ENV.MAX_PRICE_DEVIATION, 6);
                    const minAllowedPriceBN = leaderPriceBN.mul(thresholdMultiplierBN).div(safeParseUnits(1, 6));

                    if (bestBidBN.lt(minAllowedPriceBN)) {
                        const deviation = (trade.price - bestBidPrice) / trade.price;
                        return {
                            isValid: false,
                            reason: `[SKIP] Price deviation too high (Slippage). (Current Bid $${bestBidPrice.toFixed(4)} is ${(deviation * 100).toFixed(2)}% < leader's $${trade.price.toFixed(4)})`,
                        };
                    }
                }
            }
        }

        const myPositionsUrl = `https://data-api.polymarket.com/positions?user=${myWallet}`;
        const userPositionsUrl = `https://data-api.polymarket.com/positions?user=${userAddress}`;

        const [my_positions, user_positions] = await Promise.all([
            positionsBreaker.execute(() => fetchData(myPositionsUrl)),
            positionsBreaker.execute(() => fetchData(userPositionsUrl))
        ]);

        if (!Array.isArray(my_positions) || !Array.isArray(user_positions)) {
            throw new ValidationError('Invalid positions data received from API');
        }

        const my_position = my_positions.find(
            (position: UserPositionInterface) => position.conditionId === trade.conditionId
        );
        const user_position = user_positions.find(
            (position: UserPositionInterface) => position.conditionId === trade.conditionId
        );

        const my_balance = await balanceBreaker.execute(() => getMyBalance(myWallet));

        // Calculate trader's total portfolio value from positions
        const user_balance = user_positions.reduce((total, pos) => {
            return total + (pos.currentValue || 0);
        }, 0);

        // Calculate order size based on strategy
        let intendedSize = trade.usdcSize;
        const strategyConfig = ENV.COPY_STRATEGY_CONFIG;
        
        if (strategyConfig.strategy === 'FIXED') {
            intendedSize = strategyConfig.copySize;
        } else if (strategyConfig.strategy === 'PERCENTAGE' || strategyConfig.strategy === 'ADAPTIVE') {
            intendedSize = trade.usdcSize * (strategyConfig.copySize / 100.0) * (strategyConfig.tradeMultiplier || 1.0);
        }

        // Apply max order size limits
        if (strategyConfig.maxOrderSizeUSD && intendedSize > strategyConfig.maxOrderSizeUSD) {
            intendedSize = strategyConfig.maxOrderSizeUSD;
        }

        // Basic validation: ensure we have balance for buy orders
        if (trade.side === 'BUY' && my_balance < intendedSize) {
            return {
                isValid: false,
                reason: `Insufficient balance: $${my_balance.toFixed(2)} < $${intendedSize.toFixed(2)} (Trade size was $${trade.usdcSize.toFixed(2)}, Strategy: ${strategyConfig.strategy})`,
            };
        }

        return {
            isValid: true,
            myPosition: my_position,
            userPosition: user_position,
            myBalance: my_balance,
            userBalance: user_balance,
        };
    } catch (error) {
        ErrorHandler.handle(error, `Trade validation for ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`);
        return {
            isValid: false,
            reason: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
};

export { ValidationResult, validateTrade };
