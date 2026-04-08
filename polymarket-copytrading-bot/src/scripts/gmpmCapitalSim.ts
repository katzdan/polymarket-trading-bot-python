
import * as fs from 'fs';
import * as path from 'path';

/**
 * 💰 GMPM CAPITAL UTILIZATION SIMULATOR (FIXED)
 */

const STARTING_BALANCE = 1000;
const FRICTION_PERCENT = 0.005;
const GMPM_ADDRESS = '0x14964aefa2cd7caff7878b3820a690a03c5aa429';
const MARKET_CACHE_FILE = './market_data_cache.json';
const TRADER_CACHE_DIR = './trader_data_cache';

const STAKES_TO_TEST = [5, 10, 20, 50, 100];

let marketCache: any = {};
if (fs.existsSync(MARKET_CACHE_FILE)) {
    marketCache = JSON.parse(fs.readFileSync(MARKET_CACHE_FILE, 'utf8'));
}

async function runBudgetedSim(history: any[], stake: number) {
    let cash = STARTING_BALANCE;
    let skips = 0;
    let openPositions: { resolveTs: number, usdcTiedUp: number, potentialPayout: number }[] = [];

    // Sort history chronologically (oldest first)
    const trades = history.filter(t => t.side === 'BUY').sort((a,b) => a.timestamp - b.timestamp);

    for (const trade of trades) {
        // 1. Release cash from resolved positions
        const now = trade.timestamp;
        const resolved = openPositions.filter(p => p.resolveTs <= now);
        resolved.forEach(p => { cash += p.potentialPayout; });
        openPositions = openPositions.filter(p => p.resolveTs > now);

        // 2. Filters
        if (trade.usdcSize < 5) continue;
        const mData = marketCache[trade.conditionId];
        if (!mData || !mData.resolution || mData.totalVol < 10000) continue;

        // 3. Budget Check
        if (cash < stake) {
            skips++;
            continue;
        }

        // 4. Execute
        const adjustedPrice = trade.price * (1 + FRICTION_PERCENT);
        if (adjustedPrice >= 1.0) continue;

        cash -= stake;
        const resolveTs = Math.floor(new Date(mData.endDateIso).getTime() / 1000);
        const won = mData.resolution.toLowerCase().trim() === trade.outcome.toLowerCase().trim();
        const potentialPayout = won ? (stake / adjustedPrice) : 0;

        openPositions.push({ resolveTs, usdcTiedUp: stake, potentialPayout });
    }

    // Final settlement for anything still open
    openPositions.forEach(p => { cash += p.potentialPayout; });

    const totalRoi = ((cash - STARTING_BALANCE) / STARTING_BALANCE) * 100;
    return { stake, totalRoi, finalBalance: cash, skips };
}

async function main() {
    const historyPath = path.join(TRADER_CACHE_DIR, `${GMPM_ADDRESS}.json`);
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

    console.log(`\n💰 SIMULATING $1,000 BUDGET UTILIZATION FOR: gmpm`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    const results = [];
    for (const stake of STAKES_TO_TEST) {
        results.push(await runBudgetedSim(history, stake));
    }

    console.table(results.map(r => ({
        "Stake Size": `$${r.stake}`,
        "Total ROI": `${r.totalRoi.toFixed(2)}%`,
        "Final Balance": `$${r.finalBalance.toFixed(2)}`,
        "Funds-Empty Skips": r.skips
    })));
}

main();
