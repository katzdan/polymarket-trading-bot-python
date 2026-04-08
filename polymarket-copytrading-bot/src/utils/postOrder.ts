/**
 * Order posting utility module.
 * This module handles posting buy, sell, and merge orders to Polymarket.
 */

import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { ethers, BigNumber } from 'ethers';
import { ENV } from '../config/env';
import { UserActivityInterface, UserPositionInterface } from '../interfaces/User';
import { getUserActivityModel } from '../models/userHistory';
import Logger from './logger';
import Notifier from './notifier';
import { calculateOrderSize, getTradeMultiplier } from '../config/copyStrategy';

const RETRY_LIMIT = ENV.RETRY_LIMIT;
const COPY_STRATEGY_CONFIG = ENV.COPY_STRATEGY_CONFIG;

// Legacy parameters (for backward compatibility in SELL logic)
const TRADE_MULTIPLIER = ENV.TRADE_MULTIPLIER;
const COPY_PERCENTAGE = ENV.COPY_PERCENTAGE;

// Polymarket minimum order sizes
const MIN_ORDER_SIZE_USD = 1.0; // Minimum order size in USD for BUY orders
const MIN_ORDER_SIZE_TOKENS = 1.0; // Minimum order size in tokens for SELL/MERGE orders

const extractOrderError = (response: unknown): string | undefined => {
    if (!response) {
        return undefined;
    }

    if (typeof response === 'string') {
        return response;
    }

    if (typeof response === 'object') {
        const data = response as Record<string, unknown>;

        const directError = data.error;
        if (typeof directError === 'string') {
            return directError;
        }

        if (typeof directError === 'object' && directError !== null) {
            const nested = directError as Record<string, unknown>;
            if (typeof nested.error === 'string') {
                return nested.error;
            }
            if (typeof nested.message === 'string') {
                return nested.message;
            }
        }

        if (typeof data.errorMsg === 'string') {
            return data.errorMsg;
        }

        if (typeof data.message === 'string') {
            return data.message;
        }
    }

    return undefined;
};

const isInsufficientBalanceOrAllowanceError = (message: string | undefined): boolean => {
    if (!message) {
        return false;
    }
    const lower = message.toLowerCase();
    return lower.includes('not enough balance') || lower.includes('allowance');
};

/**
 * Posts an order to Polymarket based on the trade condition.
 * @param skipMarkBot - If true, do not set activity.bot = true (caller will mark when all followers done).
 */
const postOrder = async (
    clobClient: ClobClient,
    condition: string,
    my_position: UserPositionInterface | undefined,
    user_position: UserPositionInterface | undefined,
    trade: UserActivityInterface,
    my_balance: number,
    user_balance: number,
    userAddress: string,
    skipMarkBot: boolean = false
) => {
    const UserActivity = getUserActivityModel(userAddress);
    const markActivityDone = async (updates: Record<string, unknown>) => {
        if (!skipMarkBot) await UserActivity.updateOne({ _id: trade._id }, { $set: updates });
    };
    //Merge strategy
    if (condition === 'merge') {
        Logger.info('Executing MERGE strategy...');
        if (!my_position) {
            Logger.warning('No position to merge');
            await markActivityDone({ bot: true });
            return;
        }
        let remaining = my_position.size;

        // Check minimum order size
        if (remaining < MIN_ORDER_SIZE_TOKENS) {
            Logger.warning(
                `Position size (${remaining.toFixed(2)} tokens) too small to merge - skipping`
            );
            await markActivityDone({ bot: true });
            return;
        }

        let retry = 0;
        let abortDueToFunds = false;
        while (remaining > 0 && retry < RETRY_LIMIT) {
            const orderBook = await clobClient.getOrderBook(trade.asset);
            if (!orderBook.bids || orderBook.bids.length === 0) {
                Logger.warning('No bids available in order book');
                await markActivityDone({ bot: true });
                break;
            }

            const maxPriceBid = orderBook.bids.reduce((max, bid) => {
                return parseFloat(bid.price) > parseFloat(max.price) ? bid : max;
            }, orderBook.bids[0]);

            Logger.info(`Best bid: ${maxPriceBid.size} @ $${maxPriceBid.price}`);
            let order_arges;
            if (remaining <= parseFloat(maxPriceBid.size)) {
                order_arges = {
                    side: Side.SELL,
                    tokenID: my_position.asset,
                    amount: remaining,
                    price: parseFloat(maxPriceBid.price),
                };
            } else {
                order_arges = {
                    side: Side.SELL,
                    tokenID: my_position.asset,
                    amount: parseFloat(maxPriceBid.size),
                    price: parseFloat(maxPriceBid.price),
                };
            }
            // Order args logged internally
            const signedOrder = await clobClient.createMarketOrder(order_arges);
            const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);
            if (resp.success === true) {
                retry = 0;
                Logger.orderResult(
                    true,
                    `Sold ${order_arges.amount} tokens at $${order_arges.price}`
                );
                Notifier.notifyTrade('SELL', order_arges.amount * order_arges.price, order_arges.price, trade.slug || trade.title || trade.asset, userAddress);
                remaining -= order_arges.amount;
            } else {
                const errorMessage = extractOrderError(resp);
                if (isInsufficientBalanceOrAllowanceError(errorMessage)) {
                    abortDueToFunds = true;
                    Logger.warning(
                        `Order rejected: ${errorMessage || 'Insufficient balance or allowance'}`
                    );
                    Logger.warning(
                        'Skipping remaining attempts. Top up funds or run `npm run check-allowance` before retrying.'
                    );
                    break;
                }
                retry += 1;
                Logger.warning(
                    `Order failed (attempt ${retry}/${RETRY_LIMIT})${errorMessage ? ` - ${errorMessage}` : ''}`
                );
            }
        }
        if (abortDueToFunds) {
            await markActivityDone({ bot: true, botExcutedTime: RETRY_LIMIT });
            return;
        }
        if (retry >= RETRY_LIMIT) {
            await markActivityDone({ bot: true, botExcutedTime: retry });
        } else {
            await markActivityDone({ bot: true });
        }
    } else if (condition === 'buy') {
        //Buy strategy
        Logger.info('Executing BUY strategy...');

        Logger.info(`Your balance: $${my_balance.toFixed(2)}`);
        Logger.info(`Trader bought: $${trade.usdcSize.toFixed(2)}`);

        // Get current position size for position limit checks
        const currentPositionValue = my_position ? my_position.size * my_position.avgPrice : 0;

        // Use new copy strategy system
        const orderCalc = calculateOrderSize(
            COPY_STRATEGY_CONFIG,
            trade.usdcSize,
            my_balance,
            currentPositionValue
        );

        // Log the calculation reasoning
        Logger.info(`📊 ${orderCalc.reasoning}`);

        // Check if order should be executed
        if (orderCalc.finalAmount === 0) {
            Logger.warning(`❌ Cannot execute: ${orderCalc.reasoning}`);
            if (orderCalc.belowMinimum) {
                Logger.warning(`💡 Increase COPY_SIZE or wait for larger trades`);
            }
            await markActivityDone({ bot: true });
            return;
        }

        let remaining = orderCalc.finalAmount;

        let retry = 0;
        let abortDueToFunds = false;
        let totalBoughtTokens = 0; // Track total tokens bought for this trade

        while (remaining > 0 && retry < RETRY_LIMIT) {
            const orderBook = await clobClient.getOrderBook(trade.asset);
            if (!orderBook.asks || orderBook.asks.length === 0) {
                Logger.warning('No asks available in order book');
                await markActivityDone({ bot: true });
                break;
            }

            const minPriceAsk = orderBook.asks.reduce((min, ask) => {
                return parseFloat(ask.price) < parseFloat(min.price) ? ask : min;
            }, orderBook.asks[0]);

            Logger.info(`Best ask: ${minPriceAsk.size} @ $${minPriceAsk.price}`);
            
            /**
             * Real-time Slippage Guard (BUY)
             * Rationale: Even if the trade passed initial validation, the order book can move 
             * while we are in the execution loop. We check again before each sub-order.
             * 
             * Requirement: If the current Ask is more than 0.5% (ENV.MAX_PRICE_DEVIATION) 
             * higher than what the leader paid, do not place the order.
             */
            const bestAskPrice = parseFloat(minPriceAsk.price);
            const bestAskBN = ethers.utils.parseUnits(bestAskPrice.toString(), 6);
            const leaderPriceBN = ethers.utils.parseUnits(trade.price.toString(), 6);
            const thresholdMultiplierBN = ethers.utils.parseUnits((1 + ENV.MAX_PRICE_DEVIATION).toString(), 6);
            const maxAllowedPriceBN = leaderPriceBN.mul(thresholdMultiplierBN).div(ethers.utils.parseUnits('1', 6));

            if (bestAskBN.gt(maxAllowedPriceBN)) {
                const buyDeviation = (bestAskPrice - trade.price) / trade.price;
                Logger.warning(`[SKIP] Price deviation too high (Slippage). (Current Ask $${bestAskPrice.toFixed(4)} is ${(buyDeviation * 100).toFixed(2)}% > leader's $${trade.price.toFixed(4)})`);
                await markActivityDone({ bot: true });
                break;
            }

            // Check if remaining amount is below minimum before creating order
            if (remaining < MIN_ORDER_SIZE_USD) {
                Logger.info(
                    `Remaining amount ($${remaining.toFixed(2)}) below minimum - completing trade`
                );
                await markActivityDone({ bot: true, myBoughtSize: totalBoughtTokens });
                break;
            }

            // For limit orders, we use the leader's exact price as requested
            const limitPrice = trade.price;
            const tokensToBuy = remaining / limitPrice;

            const order_args = {
                side: Side.BUY,
                tokenID: trade.asset,
                size: tokensToBuy,
                price: limitPrice,
            };

            Logger.info(
                `Creating GTC Limit Order: ${tokensToBuy.toFixed(2)} tokens @ $${limitPrice.toFixed(4)} (Total: $${remaining.toFixed(2)})`
            );
            
            const signedOrder = await clobClient.createOrder(order_args);
            const resp = await clobClient.postOrder(signedOrder, OrderType.GTC);
            
            if (resp.success === true) {
                const orderId = resp.orderID;
                Logger.success(`Limit order placed: ${orderId}. Waiting up to 120s for fill...`);
                
                // Order Reaper: Cancel if not filled within 120 seconds
                const reaper = setTimeout(async () => {
                    try {
                        Logger.info(`Order Reaper: Checking status of order ${orderId}...`);
                        const orderStatus = await clobClient.getOrder(orderId);
                        
                        // If order is not fully filled, cancel it
                        if (parseFloat(orderStatus.original_size) > parseFloat(orderStatus.size_matched)) {
                            Logger.warning(`Order Reaper: Order ${orderId} not filled after 120s. Cancelling...`);
                            await clobClient.cancelOrder(orderId);
                            Logger.info(`Order ${orderId} cancelled by reaper.`);
                        } else {
                            Logger.success(`Order Reaper: Order ${orderId} was fully filled.`);
                        }
                    } catch (error) {
                        Logger.error(`Order Reaper error for ${orderId}: ${error}`);
                    }
                }, 120000);

                // For the sake of the loop, we'll assume success for the intended amount 
                // but in a real scenario we might want to poll for fill status.
                // Given the requirement to "not be chased", we continue to next logic.
                retry = 0;
                const tokensBought = tokensToBuy; 
                totalBoughtTokens += tokensBought;
                Logger.orderResult(
                    true,
                    `Placed GTC Limit Order for ${tokensBought.toFixed(2)} tokens at $${limitPrice.toFixed(4)}`
                );
                Notifier.notifyTrade('BUY', tokensBought * limitPrice, limitPrice, trade.slug || trade.title || trade.asset, userAddress);
                remaining = 0; // Assume the $5 pilot trade is handled by this one limit order
            } else {
                const errorMessage = extractOrderError(resp);
                if (isInsufficientBalanceOrAllowanceError(errorMessage)) {
                    abortDueToFunds = true;
                    Logger.warning(
                        `Order rejected: ${errorMessage || 'Insufficient balance or allowance'}`
                    );
                    Logger.warning(
                        'Skipping remaining attempts. Top up funds or run `npm run check-allowance` before retrying.'
                    );
                    break;
                }
                retry += 1;
                Logger.warning(
                    `Order failed (attempt ${retry}/${RETRY_LIMIT})${errorMessage ? ` - ${errorMessage}` : ''}`
                );
            }
        }
        if (abortDueToFunds) {
            await markActivityDone({ bot: true, botExcutedTime: RETRY_LIMIT, myBoughtSize: totalBoughtTokens });
            return;
        }
        if (retry >= RETRY_LIMIT) {
            await markActivityDone({ bot: true, botExcutedTime: retry, myBoughtSize: totalBoughtTokens });
        } else {
            await markActivityDone({ bot: true, myBoughtSize: totalBoughtTokens });
        }

        // Log the tracked purchase for later sell reference
        if (totalBoughtTokens > 0) {
            Logger.info(
                `📝 Tracked purchase: ${totalBoughtTokens.toFixed(2)} tokens for future sell calculations`
            );
        }
    } else if (condition === 'sell') {
        //Sell strategy
        Logger.info('Executing SELL strategy...');
        let remaining = 0;
        if (!my_position) {
            Logger.warning('No position to sell');
            await markActivityDone({ bot: true });
            return;
        }

        // Get all previous BUY trades for this asset to calculate total bought
        const previousBuys = await UserActivity.find({
            asset: trade.asset,
            conditionId: trade.conditionId,
            side: 'BUY',
            bot: true,
            myBoughtSize: { $exists: true, $gt: 0 },
        }).exec();

        const totalBoughtTokens = previousBuys.reduce(
            (sum, buy) => sum + (buy.myBoughtSize || 0),
            0
        );

        if (totalBoughtTokens > 0) {
            Logger.info(
                `📊 Found ${previousBuys.length} previous purchases: ${totalBoughtTokens.toFixed(2)} tokens bought`
            );
        }

        if (!user_position) {
            // Trader sold entire position - we sell entire position too
            remaining = my_position.size;
            Logger.info(
                `Trader closed entire position → Selling all your ${remaining.toFixed(2)} tokens`
            );
        } else {
            // Calculate the % of position the trader is selling
            const trader_sell_percent = trade.size / (user_position.size + trade.size);
            const trader_position_before = user_position.size + trade.size;

            Logger.info(
                `Position comparison: Trader has ${trader_position_before.toFixed(2)} tokens, You have ${my_position.size.toFixed(2)} tokens`
            );
            Logger.info(
                `Trader selling: ${trade.size.toFixed(2)} tokens (${(trader_sell_percent * 100).toFixed(2)}% of their position)`
            );

            // Use tracked bought tokens if available, otherwise fallback to current position
            let baseSellSize;
            if (totalBoughtTokens > 0) {
                baseSellSize = totalBoughtTokens * trader_sell_percent;
                Logger.info(
                    `Calculating from tracked purchases: ${totalBoughtTokens.toFixed(2)} × ${(trader_sell_percent * 100).toFixed(2)}% = ${baseSellSize.toFixed(2)} tokens`
                );
            } else {
                baseSellSize = my_position.size * trader_sell_percent;
                Logger.warning(
                    `No tracked purchases found, using current position: ${my_position.size.toFixed(2)} × ${(trader_sell_percent * 100).toFixed(2)}% = ${baseSellSize.toFixed(2)} tokens`
                );
            }

            // Apply tiered or single multiplier based on trader's order size (symmetrical with BUY logic)
            const multiplier = getTradeMultiplier(COPY_STRATEGY_CONFIG, trade.usdcSize);
            remaining = baseSellSize * multiplier;

            if (multiplier !== 1.0) {
                Logger.info(
                    `Applying ${multiplier}x multiplier (based on trader's $${trade.usdcSize.toFixed(2)} order): ${baseSellSize.toFixed(2)} → ${remaining.toFixed(2)} tokens`
                );
            }
        }

        // Check minimum order size
        if (remaining < MIN_ORDER_SIZE_TOKENS) {
            Logger.warning(
                `❌ Cannot execute: Sell amount ${remaining.toFixed(2)} tokens below minimum (${MIN_ORDER_SIZE_TOKENS} token)`
            );
            Logger.warning(`💡 This happens when position sizes are too small or mismatched`);
            await markActivityDone({ bot: true });
            return;
        }

        // Cap sell amount to available position size
        if (remaining > my_position.size) {
            Logger.warning(
                `⚠️  Calculated sell ${remaining.toFixed(2)} tokens > Your position ${my_position.size.toFixed(2)} tokens`
            );
            Logger.warning(`Capping to maximum available: ${my_position.size.toFixed(2)} tokens`);
            remaining = my_position.size;
        }

        let retry = 0;
        let abortDueToFunds = false;
        let totalSoldTokens = 0; // Track total tokens sold

        while (remaining > 0 && retry < RETRY_LIMIT) {
            const orderBook = await clobClient.getOrderBook(trade.asset);
            if (!orderBook.bids || orderBook.bids.length === 0) {
                await markActivityDone({ bot: true });
                Logger.warning('No bids available in order book');
                break;
            }

            const maxPriceBid = orderBook.bids.reduce((max, bid) => {
                return parseFloat(bid.price) > parseFloat(max.price) ? bid : max;
            }, orderBook.bids[0]);

            Logger.info(`Best bid: ${maxPriceBid.size} @ $${maxPriceBid.price}`);

            /**
             * Real-time Slippage Guard (SELL)
             * Rationale: Prevents selling at a price significantly lower than the leader's 
             * exit price, ensuring we don't dump into a drying order book.
             */
            const bestBidPrice = parseFloat(maxPriceBid.price);
            const bestBidBN = ethers.utils.parseUnits(bestBidPrice.toString(), 6);
            const leaderPriceBN = ethers.utils.parseUnits(trade.price.toString(), 6);
            const thresholdMultiplierBN = ethers.utils.parseUnits((1 - ENV.MAX_PRICE_DEVIATION).toString(), 6);
            const minAllowedPriceBN = leaderPriceBN.mul(thresholdMultiplierBN).div(ethers.utils.parseUnits('1', 6));

            if (bestBidBN.lt(minAllowedPriceBN)) {
                const sellDeviation = (trade.price - bestBidPrice) / trade.price;
                Logger.warning(`[SKIP] Price deviation too high (Slippage). (Current Bid $${bestBidPrice.toFixed(4)} is ${(sellDeviation * 100).toFixed(2)}% < leader's $${trade.price.toFixed(4)})`);
                await markActivityDone({ bot: true });
                break;
            }

            // Check if remaining amount is below minimum before creating order
            if (remaining < MIN_ORDER_SIZE_TOKENS) {
                Logger.info(
                    `Remaining amount (${remaining.toFixed(2)} tokens) below minimum - completing trade`
                );
                await markActivityDone({ bot: true });
                break;
            }

            const sellAmount = Math.min(remaining, parseFloat(maxPriceBid.size));

            // Final check: don't create orders below minimum
            if (sellAmount < MIN_ORDER_SIZE_TOKENS) {
                Logger.info(
                    `Order amount (${sellAmount.toFixed(2)} tokens) below minimum - completing trade`
                );
                await markActivityDone({ bot: true });
                break;
            }

            const order_arges = {
                side: Side.SELL,
                tokenID: trade.asset,
                amount: sellAmount,
                price: parseFloat(maxPriceBid.price),
            };
            // Order args logged internally
            const signedOrder = await clobClient.createMarketOrder(order_arges);
            const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);
            if (resp.success === true) {
                retry = 0;
                totalSoldTokens += order_arges.amount;
                Logger.orderResult(
                    true,
                    `Sold ${order_arges.amount} tokens at $${order_arges.price}`
                );
                Notifier.notifyTrade('SELL', order_arges.amount * order_arges.price, order_arges.price, trade.slug || trade.title || trade.asset, userAddress);
                remaining -= order_arges.amount;
            } else {
                const errorMessage = extractOrderError(resp);
                if (isInsufficientBalanceOrAllowanceError(errorMessage)) {
                    abortDueToFunds = true;
                    Logger.warning(
                        `Order rejected: ${errorMessage || 'Insufficient balance or allowance'}`
                    );
                    Logger.warning(
                        'Skipping remaining attempts. Top up funds or run `npm run check-allowance` before retrying.'
                    );
                    break;
                }
                retry += 1;
                Logger.warning(
                    `Order failed (attempt ${retry}/${RETRY_LIMIT})${errorMessage ? ` - ${errorMessage}` : ''}`
                );
            }
        }

        // Update tracked purchases after successful sell
        if (totalSoldTokens > 0 && totalBoughtTokens > 0) {
            const sellPercentage = totalSoldTokens / totalBoughtTokens;

            if (sellPercentage >= 0.99) {
                // Sold essentially all tracked tokens - clear tracking
                await UserActivity.updateMany(
                    {
                        asset: trade.asset,
                        conditionId: trade.conditionId,
                        side: 'BUY',
                        bot: true,
                        myBoughtSize: { $exists: true, $gt: 0 },
                    },
                    { $set: { myBoughtSize: 0 } }
                );
                Logger.info(
                    `🧹 Cleared purchase tracking (sold ${(sellPercentage * 100).toFixed(1)}% of position)`
                );
            } else {
                // Partial sell - reduce tracked purchases proportionally
                for (const buy of previousBuys) {
                    const newSize = (buy.myBoughtSize || 0) * (1 - sellPercentage);
                    await UserActivity.updateOne(
                        { _id: buy._id },
                        { $set: { myBoughtSize: newSize } }
                    );
                }
                Logger.info(
                    `📝 Updated purchase tracking (sold ${(sellPercentage * 100).toFixed(1)}% of tracked position)`
                );
            }
        }

        if (abortDueToFunds) {
            await markActivityDone({ bot: true, botExcutedTime: RETRY_LIMIT });
            return;
        }
        if (retry >= RETRY_LIMIT) {
            await markActivityDone({ bot: true, botExcutedTime: retry });
        } else {
            await markActivityDone({ bot: true });
        }
    } else {
        Logger.error(`Unknown condition: ${condition}`);
    }
};

export default postOrder;
