
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🎯 GMPM STRATEGY OPTIMIZER
 * Goal: Find the configuration with the fewest trades that maintains high ROI.
 */

const STARTING_BALANCE = 1000;
const FIXED_STAKE = 10;
const FRICTION_PERCENT = 0.005;
const GMPM_ADDRESS = '0x14964aefa2cd7caff7878b3820a690a03c5aa429';
const MARKET_CACHE_FILE = './market_data_cache.json';
const TRADER_CACHE_DIR = './trader_data_cache';

const TEST_MIN_TRADES = [10, 50, 100, 250, 500, 1000, 2500];
const TEST_MIN_VOLS = [10000, 50000, 100000, 250000, 500000];

let marketCache: any = {};
if (fs.existsSync(MARKET_CACHE_FILE)) {
    marketCache = JSON.parse(fs.readFileSync(MARKET_CACHE_FILE, 'utf8'));
}

async function runSim(history: any[], minTrade: number, minVol: number) {
    let balance = STARTING_BALANCE;
    let wins = 0; let losses = 0; let executedCount = 0;
    
    const buyTrades = history.filter(t => t.side === 'BUY');
    if (buyTrades.length === 0) return null;

    for (const trade of buyTrades) {
        if (trade.usdcSize < minTrade) continue;
        
        const mData = marketCache[trade.conditionId];
        if (!mData || !mData.resolution) continue;

        // Liquidity Proxy
        const hasLiquidity = mData.totalVol >= minVol || trade.usdcSize >= (minVol / 100);
        if (!hasLiquidity) continue;

        const adjustedPrice = trade.price * (1 + FRICTION_PERCENT);
        if (adjustedPrice >= 1.0) continue;

        executedCount++;
        if (mData.resolution.toLowerCase().trim() === trade.outcome.toLowerCase().trim()) {
            wins++;
            balance += FIXED_STAKE * (1 / adjustedPrice - 1);
        } else {
            losses++;
            balance -= FIXED_STAKE;
        }
    }

    const roi = ((balance - STARTING_BALANCE) / STARTING_BALANCE) * 100;
    return { minTrade, minVol, executedCount, wins, losses, roi };
}

async function optimize() {
    const historyPath = path.join(TRADER_CACHE_DIR, `${GMPM_ADDRESS}.json`);
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

    console.log(`\n🎯 OPTIMIZING STRATEGY FOR: gmpm`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    const results = [];
    for (const mt of TEST_MIN_TRADES) {
        for (const mv of TEST_MIN_VOLS) {
            const res = await runSim(history, mt, mv);
            if (res && res.executedCount > 0 && res.roi > 0) {
                results.push(res);
            }
        }
    }

    // Sort by ROI descending
    results.sort((a, b) => b.roi - a.roi);

    console.log(`Top 15 Most Efficient Configurations:`);
    console.table(results.slice(0, 15).map(r => ({
        "Min Trade": `$${r.minTrade}`,
        "Min Vol": `$${r.minVol/1000}k`,
        "Trades": r.executedCount,
        "W/L": `${r.wins}/${r.losses}`,
        "Win Rate": `${((r.wins/r.executedCount)*100).toFixed(1)}%`,
        "Total ROI": `${r.roi.toFixed(2)}%`
    })));
}

optimize();
