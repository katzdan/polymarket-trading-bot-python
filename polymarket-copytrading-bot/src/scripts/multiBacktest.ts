
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🚀 HIGH-PERFORMANCE MULTI-STRATEGY BACKTESTER (v10)
 * Optimized for 1000+ traders across all categories.
 */

const FILTERS = {
    minLeaderTradeUsd: [5, 50, 500],
    minMarket24hVol: [10000, 50000, 100000],
    maxPriceDeviation: [0.005, 0.01, 0.02] 
};

const TIME_FRAMES = [730, 365, 90]; 
const STARTING_BALANCE = 1000;
const COPY_SIZE_USD = 10;
const TRADER_CACHE_DIR = './trader_data_cache';
const MARKET_CACHE_FILE = './market_data_cache.json';
const TOP_TRADERS_FILE = 'top_traders_by_category.json';
const CONCURRENCY_LIMIT = 3; // Adjust based on rate limits

interface HistoricalTrade {
    id: string; timestamp: number; asset: string; market: string;
    side: 'BUY' | 'SELL'; price: number; usdcSize: number;
    conditionId: string; outcome: string;
}

interface MarketData {
    resolution: string | null;
    totalVol: number;
    endDateIso: string;
}

interface BacktestResult {
    trader: string; address: string; category: string; timeframe: number;
    minTrade: number; minVol: number; maxDev: number;
    executedCount: number; wins: number; losses: number;
    finalBalance: number; roi: number; annualRoi: number;
    avgHoldingDays: number;
}

// --- Setup ---
if (!fs.existsSync(TRADER_CACHE_DIR)) fs.mkdirSync(TRADER_CACHE_DIR);
let marketCache: Record<string, MarketData> = {};
if (fs.existsSync(MARKET_CACHE_FILE)) {
    try { marketCache = JSON.parse(fs.readFileSync(MARKET_CACHE_FILE, 'utf8')); } catch(e) {}
}

const saveMarketCache = () => fs.writeFileSync(MARKET_CACHE_FILE, JSON.stringify(marketCache));

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.get(url, { timeout: 15000 });
            return res.data;
        } catch (e: any) {
            if (e.response?.status === 404) return null;
            if (i === retries - 1) return null;
            await delay(1000 * (i + 1));
        }
    }
}

async function getTraderHistory(address: string): Promise<HistoricalTrade[]> {
    const cachePath = path.join(TRADER_CACHE_DIR, `${address}.json`);
    if (fs.existsSync(cachePath)) return JSON.parse(fs.readFileSync(cachePath, 'utf8'));

    // Fetch logic for new traders
    let allTrades: any[] = [];
    let offset = 0;
    const limit = 100;
    while (allTrades.length < 1000) {
        const url = `https://data-api.polymarket.com/activity?user=${address}&type=TRADE&limit=${limit}&offset=${offset}`;
        const data = await fetchWithRetry(url);
        if (!data || data.length === 0) break;
        allTrades = allTrades.concat(data);
        offset += limit;
        if (data.length < limit) break;
        await delay(200);
    }
    const mapped = allTrades.map(t => ({
        id: t.id, timestamp: t.timestamp, asset: t.asset, market: t.slug || t.market,
        side: t.side, price: parseFloat(t.price), usdcSize: parseFloat(t.usdcSize),
        conditionId: t.conditionId, outcome: t.outcome
    }));
    fs.writeFileSync(cachePath, JSON.stringify(mapped));
    return mapped;
}

async function getOrFetchMarketData(conditionId: string): Promise<MarketData | null> {
    if (marketCache[conditionId]) return marketCache[conditionId];

    try {
        const url = `https://clob.polymarket.com/markets/${conditionId}`;
        const data = await fetchWithRetry(url);
        if (data && data.tokens) {
            const winningToken = data.tokens.find((t: any) => t.winner === true);
            const res: MarketData = {
                resolution: winningToken ? winningToken.outcome : null,
                totalVol: 0, // We will use leader trade as proxy if needed, or fetch from Gamma
                endDateIso: data.end_date_iso
            };
            
            // Try Gamma for total volume
            const gUrl = `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`;
            const gData = await fetchWithRetry(gUrl);
            if (gData && Array.isArray(gData)) {
                const exact = gData.find(m => m.conditionId?.toLowerCase() === conditionId.toLowerCase());
                if (exact) res.totalVol = parseFloat(exact.volume || "0");
            }

            marketCache[conditionId] = res;
            if (Object.keys(marketCache).length % 10 === 0) saveMarketCache();
            return res;
        }
    } catch {}
    return null;
}

async function runSimulation(
    traderName: string, address: string, category: string, history: HistoricalTrade[],
    timeframeDays: number, minTrade: number, minVol: number, maxDev: number
): Promise<BacktestResult> {
    const cutoffTs = Math.floor(Date.now() / 1000) - (timeframeDays * 24 * 3600);
    let balance = STARTING_BALANCE;
    let wins = 0; let losses = 0; let executedCount = 0;
    const holdingDurations: number[] = [];

    const buyTrades = history.filter(t => t.side === 'BUY' && t.timestamp > cutoffTs);

    for (const trade of buyTrades) {
        if (trade.usdcSize < minTrade) continue;
        
        const mData = await getOrFetchMarketData(trade.conditionId);
        if (!mData) continue;

        // Liquidity check: Use Gamma total volume OR Leader trade proxy
        const hasLiquidity = mData.totalVol >= minVol || trade.usdcSize >= (minVol / 100);
        if (!hasLiquidity) continue;

        if (!mData.resolution) continue;

        executedCount++;
        const res = mData.resolution;
        const resolutionTs = Math.floor(new Date(mData.endDateIso).getTime() / 1000);
        const durationDays = (resolutionTs - trade.timestamp) / (24 * 3600);
        if (durationDays > 0) holdingDurations.push(durationDays);

        if (res.toLowerCase().trim() === trade.outcome.toLowerCase().trim()) {
            wins++;
            balance += COPY_SIZE_USD * (1 / trade.price - 1);
        } else {
            losses++;
            balance -= COPY_SIZE_USD;
        }
    }

    const roi = ((balance - STARTING_BALANCE) / STARTING_BALANCE) * 100;
    const annualRoi = (roi / timeframeDays) * 365;
    const avgHoldingDays = holdingDurations.length > 0 ? holdingDurations.reduce((a,b)=>a+b,0)/holdingDurations.length : 0;

    return {
        trader: traderName, address, category, timeframe: timeframeDays,
        minTrade, minVol, maxDev, executedCount, wins, losses,
        finalBalance: balance, roi, annualRoi, avgHoldingDays
    };
}

function getLinks(address: string) {
    return `<a href="https://polymarket.com/profile/${address}" target="_blank">PM</a> <a href="https://predictfolio.com/profile/${address}" target="_blank">PF</a>`;
}

async function main() {
    console.log("🚀 STARTING BATCH BACKTEST v10 (Top 100 Traders/Category)...");
    const topTradersData = JSON.parse(fs.readFileSync(TOP_TRADERS_FILE, 'utf8'));
    const categories = Object.keys(topTradersData);
    
    // 1. Gather all unique traders
    const uniqueTradersMap = new Map<string, {name: string, address: string, cats: string[]}>();
    categories.forEach(cat => {
        topTradersData[cat].slice(0, 100).forEach((t: any) => {
            const addr = t.proxyWallet.toLowerCase();
            if (!uniqueTradersMap.has(addr)) {
                uniqueTradersMap.set(addr, {name: t.userName || addr.slice(0,10), address: addr, cats: []});
            }
            uniqueTradersMap.get(addr)!.cats.push(cat);
        });
    });

    const uniqueTraders = Array.from(uniqueTradersMap.values());
    console.log(`📊 Found ${uniqueTraders.length} unique traders to simulate.`);

    const allResults: BacktestResult[] = [];
    let processed = 0;

    // 2. Process in chunks to maintain concurrency and show progress
    for (let i = 0; i < uniqueTraders.length; i += CONCURRENCY_LIMIT) {
        const chunk = uniqueTraders.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(chunk.map(async (t) => {
            const history = await getTraderHistory(t.address);
            if (!history || history.length === 0) return;

            for (const days of TIME_FRAMES) {
                const seenSignatures = new Set<string>();
                for (const minTrade of FILTERS.minLeaderTradeUsd) {
                    for (const minVol of FILTERS.minMarket24hVol) {
                        for (const maxDev of FILTERS.maxPriceDeviation) {
                            const res = await runSimulation(t.name, t.address, t.cats[0], history, days, minTrade, minVol, maxDev);
                            if (res.executedCount > 0) {
                                const sig = `${days}-${res.executedCount}-${res.roi.toFixed(4)}`;
                                if (!seenSignatures.has(sig)) {
                                    // Map this result to ALL categories this trader belongs to
                                    t.cats.forEach(cat => {
                                        allResults.push({...res, category: cat});
                                    });
                                    seenSignatures.add(sig);
                                }
                            }
                        }
                    }
                }
            }
            processed++;
            if (processed % 10 === 0) console.log(`✅ Processed ${processed}/${uniqueTraders.length} traders...`);
        }));
        saveMarketCache();
    }

    console.log("📝 Generating HTML Report...");
    allResults.sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return b.roi - a.roi;
    });

    let html = `<!DOCTYPE html><html><head><title>Backtest v10</title><style>
        body { font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; }
        h2 { color: #8b5cf6; background: #1e293b; padding: 10px; border-radius: 8px; margin-top: 40px; }
        table { width: 100%; border-collapse: collapse; background: #1e293b; }
        th, td { padding: 10px; border-bottom: 1px solid #334155; text-align: left; font-size: 0.9rem; }
        th { background: #334155; color: #38bdf8; }
        .roi-pos { color: #4ade80; font-weight: bold; }
        .roi-neg { color: #f87171; }
        .filter-tag { font-size: 0.7rem; background: #0ea5e9; padding: 2px 4px; border-radius: 4px; margin-right: 2px; }
    </style></head><body><h1>📊 Global Backtest Results v10 (Top 100/Category)</h1>`;

    let currentCat = "";
    allResults.forEach(r => {
        if (r.category !== currentCat) {
            if (currentCat !== "") html += `</tbody></table>`;
            currentCat = r.category;
            html += `<h2>📂 ${currentCat}</h2><table><thead><tr><th>Trader</th><th>Days</th><th>Filters</th><th>Trades</th><th>W/L</th><th>Avg Hold</th><th>ROI</th><th>Annual ROI</th></tr></thead><tbody>`;
        }
        html += `<tr><td><strong>${r.trader}</strong><br/>${getLinks(r.address)}</td><td>${r.timeframe}d</td>
        <td><span class="filter-tag">>$${r.minTrade}</span><span class="filter-tag">>${r.minVol/1000}k</span></td>
        <td>${r.executedCount}</td><td>${r.wins}/${r.losses}</td><td>${r.avgHoldingDays.toFixed(1)}d</td>
        <td class="${r.roi>=0?'roi-pos':'roi-neg'}">${r.roi.toFixed(2)}%</td>
        <td style="color:#fbbf24; font-weight:bold;">${r.annualRoi.toFixed(2)}%</td></tr>`;
    });
    html += `</tbody></table></body></html>`;
    fs.writeFileSync('global_backtest_report.html', html);
    console.log("✅ DONE! Report saved to global_backtest_report.html");
}

main().catch(console.error);
