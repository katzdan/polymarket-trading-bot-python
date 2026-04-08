
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🚀 HIGH-SPEED BUDGET BACKTESTER (v22)
 * Bypasses failing Gamma Volume fetch for massive speed.
 * Uses Leader Trade Size as high-fidelity Liquidity Proxy.
 */

const STARTING_BALANCE = 1000;
const STAKE_USD = 25; 
const FRICTION_PERCENT = 0.005;
const ACTIVITY_THRESHOLD_DAYS = 30;
const TIME_FRAMES = [365]; 
const TRADER_CACHE_DIR = './trader_data_cache';
const MARKET_CACHE_FILE = './market_data_cache.json';
const TOP_TRADERS_FILE = 'top_traders_by_category.json';

interface HistoricalTrade {
    id: string; timestamp: number; asset: string; market: string;
    side: 'BUY' | 'SELL'; price: number; usdcSize: number;
    conditionId: string; outcome: string;
}

interface MarketData {
    resolution: string | null;
    endDateIso: string;
}

let marketCache: Record<string, MarketData> = {};
if (fs.existsSync(MARKET_CACHE_FILE)) {
    marketCache = JSON.parse(fs.readFileSync(MARKET_CACHE_FILE, 'utf8'));
}

async function runSimulation(
    traderName: string, address: string, category: string, history: HistoricalTrade[],
    timeframeDays: number, minTrade: number, minVol: number, refPnl: number
): Promise<any> {
    const nowTs = Math.floor(Date.now() / 1000);
    const cutoffTs = nowTs - (timeframeDays * 24 * 3600);
    
    let cash = STARTING_BALANCE;
    let wins = 0; let losses = 0; let executedCount = 0; let cashSkips = 0;
    const holdingDurations: number[] = [];
    const openPositions: { resolveTs: number, potentialPayout: number }[] = [];

    const buyTrades = history.filter(t => t.side === 'BUY' && t.timestamp > cutoffTs).sort((a,b) => a.timestamp - b.timestamp);
    if (buyTrades.length === 0) return null;

    for (const trade of buyTrades) {
        // Release cash
        const tNow = trade.timestamp;
        const resolved = openPositions.filter(p => p.resolveTs <= tNow);
        resolved.forEach(p => { cash += p.potentialPayout; });
        const remainingOpen = openPositions.filter(p => p.resolveTs > tNow);
        openPositions.length = 0;
        openPositions.push(...remainingOpen);

        // Filters
        if (trade.usdcSize < minTrade) continue;
        const mData = marketCache[trade.conditionId];
        if (!mData || !mData.resolution) continue;

        // Liquidity Proxy: If leader traded > 1/100th of minVol filter, assume liquid
        if (trade.usdcSize < (minVol / 100)) continue;

        if (cash < STAKE_USD) {
            cashSkips++;
            continue;
        }

        const adjustedPrice = trade.price * (1 + FRICTION_PERCENT);
        if (adjustedPrice >= 1.0) continue;

        cash -= STAKE_USD;
        executedCount++;
        const resolveTs = Math.floor(new Date(mData.endDateIso).getTime() / 1000);
        const won = mData.resolution.toLowerCase().trim() === trade.outcome.toLowerCase().trim();
        const potentialPayout = won ? (STAKE_USD / adjustedPrice) : 0;
        
        if (won) wins++; else losses++;
        openPositions.push({ resolveTs, potentialPayout });
        if (resolveTs > trade.timestamp) holdingDurations.push((resolveTs - trade.timestamp) / (24*3600));
    }

    openPositions.forEach(p => { cash += p.potentialPayout; });
    const roi = ((cash - STARTING_BALANCE) / STARTING_BALANCE) * 100;

    return {
        trader: traderName.split('-')[0], address, category, timeframe: timeframeDays,
        minTrade, minVol, executedCount, wins, losses,
        roi, annualRoi: timeframeDays <= 365 ? roi : roi/2,
        dataSpanDays: Math.max(1, (buyTrades[buyTrades.length-1].timestamp - buyTrades[0].timestamp)/(24*3600)),
        refPnl, avgHoldingDays: holdingDurations.length > 0 ? holdingDurations.reduce((a,b)=>a+b,0)/holdingDurations.length : 0,
        cashSkips, startDate: new Date(buyTrades[0].timestamp * 1000).toLocaleDateString(),
        endDate: new Date(buyTrades[buyTrades.length-1].timestamp * 1000).toLocaleDateString()
    };
}

async function main() {
    console.log(`🚀 STARTING FAST-BUDGET BACKTEST v22 ($${STARTING_BALANCE} budget, $${STAKE_USD} stake)...`);
    const topTradersData = JSON.parse(fs.readFileSync(TOP_TRADERS_FILE, 'utf8'));
    const results: any[] = [];

    const categories = ['OVERALL', 'CULTURE', 'POLITICS', 'CRYPTO', 'TECH'];

    for (const cat of categories) {
        console.log(`📂 Category: ${cat}`);
        const traders = topTradersData[cat].slice(0, 20); // Top 20 for balanced speed/depth

        for (const t of traders) {
            const historyPath = path.join(TRADER_CACHE_DIR, `${t.proxyWallet.toLowerCase()}.json`);
            if (!fs.existsSync(historyPath)) continue;
            const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
            if (history.length === 0) continue;
            if ((Date.now()/1000 - history[0].timestamp)/(24*3600) > ACTIVITY_THRESHOLD_DAYS) continue;

            for (const days of TIME_FRAMES) {
                let best: any = null;
                // Test realistic filters
                for (const minTrade of [5, 500]) {
                    for (const minVol of [10000, 100000]) {
                        const res = await runSimulation(t.userName || t.proxyWallet.slice(0,10), t.proxyWallet, cat, history, days, minTrade, minVol, 0);
                        if (res && res.executedCount > 0 && res.roi > 0) {
                            if (!best || res.roi > best.roi) best = res;
                        }
                    }
                }
                if (best) results.push(best);
            }
            process.stdout.write(".");
        }
        console.log(" done.");
    }

    results.sort((a,b) => b.roi - a.roi);

    let html = `<!DOCTYPE html><html><head><title>Backtest v22</title><style>
        body { font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; }
        h2 { color: #8b5cf6; background: #1e293b; padding: 10px; border-radius: 8px; margin-top: 40px; }
        table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
        th, td { padding: 12px; border-bottom: 1px solid #334155; text-align: left; }
        .roi-pos { color: #4ade80; font-weight: bold; }
        .config-box { background: #0f172a; padding: 8px; border-radius: 4px; font-family: monospace; font-size: 0.7rem; color: #94a3b8; }
    </style></head><body><h1>📊 $1,000 Budget Backtest v22 ($25 Stakes)</h1>`;

    results.forEach(r => {
        html += `<tr><td><strong>${r.trader}</strong></td><td>ROI: <span class="roi-pos">${r.roi.toFixed(2)}%</span></td>
        <td>Trades: ${r.executedCount} | Cash Skips: ${r.cashSkips}</td>
        <td><div class="config-box">USER_ADDRESSES='${r.address}'\nMIN_LEADER_TRADE_USD=${r.minTrade}\nMIN_MARKET_24H_VOL=${r.minVol}\nCOPY_SIZE=${STAKE_USD}</div></td></tr>`;
    });
    // Simplified table for speed
    fs.writeFileSync('global_backtest_report.html', html);
    console.log("✅ DONE!");
}

main();
