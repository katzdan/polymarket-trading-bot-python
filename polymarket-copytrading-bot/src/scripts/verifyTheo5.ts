
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🔍 FIXED THEO5 VERIFICATION
 * Aligned with Main Backtest Logic (Volume & Slippage filters included).
 */

const STARTING_BALANCE = 1000;
const FIXED_STAKE = 10;
const THEO5_ADDRESS = '0x8a4c788f043023b8b28a762216d037e9f148532b';
const TRADER_CACHE_DIR = './trader_data_cache';
const MARKET_CACHE_FILE = './market_data_cache.json';

let marketCache: any = {};
if (fs.existsSync(MARKET_CACHE_FILE)) {
    marketCache = JSON.parse(fs.readFileSync(MARKET_CACHE_FILE, 'utf8'));
}

async function runSingleSim(history: any[], minTrade: number, minVol: number) {
    let balance = STARTING_BALANCE;
    let wins = 0; let losses = 0; let executedCount = 0;

    const buyTrades = history.filter(t => t.side === 'BUY');

    for (const trade of buyTrades) {
        // 1. Min Trade Filter
        if (trade.usdcSize < minTrade) continue;
        
        const mData = marketCache[trade.conditionId];
        if (!mData || !mData.resolution) continue;

        // 2. Liquidity Filter (MUST MATCH MAIN BACKTEST)
        const hasLiquidity = mData.totalVol >= minVol || trade.usdcSize >= (minVol / 100);
        if (!hasLiquidity) continue;

        executedCount++;
        if (mData.resolution.toLowerCase().trim() === trade.outcome.toLowerCase().trim()) {
            wins++;
            balance += FIXED_STAKE * (1 / trade.price - 1);
        } else {
            losses++;
            balance -= FIXED_STAKE;
        }
    }

    return {
        minTrade,
        minVol,
        executedCount,
        wins,
        losses,
        roi: ((balance - STARTING_BALANCE) / STARTING_BALANCE) * 100
    };
}

async function verify() {
    const historyPath = path.join(TRADER_CACHE_DIR, `${THEO5_ADDRESS}.json`);
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

    console.log(`\n🔍 VERIFYING THEO5 ROI (WITH LIQUIDITY FILTERS)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    const results = [];
    // Testing requested lower thresholds
    results.push(await runSingleSim(history, 5, 10000));
    results.push(await runSingleSim(history, 4, 10000));
    results.push(await runSingleSim(history, 3, 10000));
    results.push(await runSingleSim(history, 2, 10000));
    results.push(await runSingleSim(history, 1, 10000));

    console.table(results);
}

verify();
