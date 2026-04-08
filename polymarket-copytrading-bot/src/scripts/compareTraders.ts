
import * as fs from 'fs';
import * as path from 'path';

/**
 * 📊 TRADER PERFORMANCE COMPARISON (v24)
 * Comparing 1-Year vs 2-Year performance for Top Traders.
 * Budget: $1,000 | Stake: $25 | Friction: 0.5%
 */

const STARTING_BALANCE = 1000;
const STAKE_USD = 25;
const FRICTION_PERCENT = 0.005;
const TRADER_CACHE_DIR = './trader_data_cache';
const MARKET_CACHE_FILE = './market_data_cache.json';

const TARGETS = [
    { name: 'Theo5', addr: '0x8a4c788f043023b8b28a762216d037e9f148532b' },
    { name: 'flydartball', addr: '0x37d10ffb61998561c5f9fb941c42c952d8fb4e28' },
    { name: 'SaylorMoon', addr: '0xf797d4d1c038d1eb0593edae0e66bf8e4b2e0bf2' },
    { name: 'Big.Chungus', addr: '0x16b29c50f2439faf627209b2ac0c7bbddaa8a881' }
];

let marketCache: any = {};
if (fs.existsSync(MARKET_CACHE_FILE)) {
    marketCache = JSON.parse(fs.readFileSync(MARKET_CACHE_FILE, 'utf8'));
}

async function runBudgetedSim(history: any[], timeframeDays: number) {
    const cutoffTs = Math.floor(Date.now() / 1000) - (timeframeDays * 24 * 3600);
    let cash = STARTING_BALANCE;
    let tradeIdx = 0; let openPositions: { resolveTs: number, potentialPayout: number }[] = [];
    const trades = history.filter(t => t.side === 'BUY' && t.timestamp > cutoffTs).sort((a,b) => a.timestamp - b.timestamp);
    
    if (trades.length === 0) return { roi: 0, trades: 0 };

    for (const trade of trades) {
        const tNow = trade.timestamp;
        const resolved = openPositions.filter(p => p.resolveTs <= tNow);
        resolved.forEach(p => { cash += p.potentialPayout; });
        openPositions = openPositions.filter(p => p.resolveTs > tNow);

        const mData = marketCache[trade.conditionId];
        if (!mData || !mData.resolution || mData.totalVol < 10000) {
            // if (timeframeDays === 365) console.log(`Skip ${trade.market}: No resolution or low vol`);
            continue;
        }

        if (cash < STAKE_USD) continue;

        const adjustedPrice = trade.price * (1 + FRICTION_PERCENT);
        if (adjustedPrice >= 1.0) continue;

        cash -= STAKE_USD;
        const resolveTs = Math.floor(new Date(mData.endDateIso).getTime() / 1000);
        const normalizedRes = mData.resolution.toLowerCase().trim();
        const normalizedOutcome = trade.outcome.toLowerCase().trim();
        const won = normalizedRes === normalizedOutcome;
        
        const potentialPayout = won ? (STAKE_USD / adjustedPrice) : 0;
        openPositions.push({ resolveTs, potentialPayout });

        if (timeframeDays === 365 && tradeIdx < 5) {
            console.log(`[DEBUG] ${trade.market}: Res="${normalizedRes}", Pick="${normalizedOutcome}", Won=${won}, Payout=${potentialPayout.toFixed(2)}`);
        }
        tradeIdx++;
    }
    openPositions.forEach(p => { cash += p.potentialPayout; });
    return { roi: ((cash - STARTING_BALANCE) / STARTING_BALANCE) * 100, trades: trades.length };
}

async function compare() {
    console.log(`\n📊 1-YEAR VS 2-YEAR PERFORMANCE COMPARISON ($25 Stake)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    const results = [];
    for (const t of TARGETS) {
        const pathFile = path.join(TRADER_CACHE_DIR, `${t.addr.toLowerCase()}.json`);
        if (!fs.existsSync(pathFile)) continue;
        const history = JSON.parse(fs.readFileSync(pathFile, 'utf8'));

        const year1 = await runBudgetedSim(history, 365);
        const year2 = await runBudgetedSim(history, 730);

        results.push({
            "Trader": t.name,
            "1Y ROI": `${year1.roi.toFixed(2)}%`,
            "1Y Trades": year1.trades,
            "2Y ROI": `${year2.roi.toFixed(2)}%`,
            "2Y Trades": year2.trades,
            "Trend": year1.roi > (year2.roi / 2) ? "📈 Improving" : "📉 Slowing"
        });
    }

    console.table(results);
}

compare();
