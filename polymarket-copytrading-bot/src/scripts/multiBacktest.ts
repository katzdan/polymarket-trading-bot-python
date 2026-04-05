
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🚀 ELITE MULTI-STRATEGY BACKTESTER (v11)
 * Fixed: Annualization logic, Increased history (5000 trades), and Compounding ROI.
 */

const FILTERS = {
    minLeaderTradeUsd: [5, 50, 500],
    minMarket24hVol: [10000, 50000, 100000],
    maxPriceDeviation: [0.005, 0.01, 0.02] 
};

const TIME_FRAMES = [730, 365, 90]; 
const STARTING_BALANCE = 1000;
const TRADER_CACHE_DIR = './trader_data_cache';
const MARKET_CACHE_FILE = './market_data_cache.json';
const TOP_TRADERS_FILE = 'top_traders_by_category.json';
const CONCURRENCY_LIMIT = 3;

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
    avgHoldingDays: number; dataSpanDays: number;
}

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
    
    // If cache is old or small, re-fetch (increased to 5000 trades)
    if (fs.existsSync(cachePath)) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (cached.length >= 1000) return cached; 
    }

    console.log(`📡 Fetching deep history for ${address}...`);
    let allTrades: any[] = [];
    let offset = 0;
    const limit = 100;
    while (allTrades.length < 5000) {
        const url = `https://data-api.polymarket.com/activity?user=${address}&type=TRADE&limit=${limit}&offset=${offset}`;
        const data = await fetchWithRetry(url);
        if (!data || data.length === 0) break;
        allTrades = allTrades.concat(data);
        offset += limit;
        if (data.length < limit) break;
        await delay(100);
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
                totalVol: 0,
                endDateIso: data.end_date_iso
            };
            const gUrl = `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`;
            const gData = await fetchWithRetry(gUrl);
            if (gData && Array.isArray(gData)) {
                const exact = gData.find(m => m.conditionId?.toLowerCase() === conditionId.toLowerCase());
                if (exact) res.totalVol = parseFloat(exact.volume || "0");
            }
            marketCache[conditionId] = res;
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
    if (buyTrades.length === 0) return {} as any;

    // To calculate accurate annual ROI, we need the span of trades found
    const firstTradeTs = buyTrades[buyTrades.length - 1].timestamp;
    const lastTradeTs = buyTrades[0].timestamp;
    const dataSpanDays = Math.max(1, (lastTradeTs - firstTradeTs) / (24 * 3600));

    for (const trade of buyTrades) {
        if (trade.usdcSize < minTrade) continue;
        const mData = await getOrFetchMarketData(trade.conditionId);
        if (!mData || !mData.resolution) continue;
        if (mData.totalVol < minVol && trade.usdcSize < (minVol / 100)) continue;

        executedCount++;
        const res = mData.resolution;
        const resolutionTs = Math.floor(new Date(mData.endDateIso).getTime() / 1000);
        const durationDays = (resolutionTs - trade.timestamp) / (24 * 3600);
        if (durationDays > 0) holdingDurations.push(durationDays);

        // Compounding Logic: Invest 5% of current balance or at least $10
        const stake = Math.max(10, balance * 0.05);
        if (res.toLowerCase().trim() === trade.outcome.toLowerCase().trim()) {
            wins++;
            balance += stake * (1 / trade.price - 1);
        } else {
            losses++;
            balance -= stake;
        }
        if (balance <= 0) { balance = 0; break; }
    }

    const roi = ((balance - STARTING_BALANCE) / STARTING_BALANCE) * 100;
    // Annualized ROI based on the ACTUAL SPAN of trades processed
    const annualRoi = (roi / dataSpanDays) * 365;
    const avgHoldingDays = holdingDurations.length > 0 ? holdingDurations.reduce((a,b)=>a+b,0)/holdingDurations.length : 0;

    return {
        trader: traderName, address, category, timeframe: timeframeDays,
        minTrade, minVol, maxDev, executedCount, wins, losses,
        finalBalance: balance, roi, annualRoi, avgHoldingDays, dataSpanDays
    };
}

async function main() {
    console.log("🚀 STARTING ELITE BACKTEST v11...");
    const topTradersData = JSON.parse(fs.readFileSync(TOP_TRADERS_FILE, 'utf8'));
    const categories = Object.keys(topTradersData);
    const uniqueTradersMap = new Map<string, {name: string, address: string, cats: string[]}>();
    categories.forEach(cat => {
        topTradersData[cat].slice(0, 100).forEach((t: any) => {
            const addr = t.proxyWallet.toLowerCase();
            if (!uniqueTradersMap.has(addr)) uniqueTradersMap.set(addr, {name: t.userName || addr.slice(0,10), address: addr, cats: []});
            uniqueTradersMap.get(addr)!.cats.push(cat);
        });
    });

    const uniqueTraders = Array.from(uniqueTradersMap.values());
    const allResults: BacktestResult[] = [];
    let processed = 0;

    for (let i = 0; i < uniqueTraders.length; i += CONCURRENCY_LIMIT) {
        const chunk = uniqueTraders.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(chunk.map(async (t) => {
            const history = await getTraderHistory(t.address);
            if (!history || history.length === 0) return;
            for (const days of TIME_FRAMES) {
                const seenSignatures = new Set<string>();
                for (const minTrade of FILTERS.minLeaderTradeUsd) {
                    for (const minVol of FILTERS.minMarket24hVol) {
                        const res = await runSimulation(t.name, t.address, t.cats[0], history, days, minTrade, minVol, 0.005);
                        if (res.executedCount > 0) {
                            const sig = `${days}-${res.executedCount}-${res.roi.toFixed(4)}`;
                            if (!seenSignatures.has(sig)) {
                                t.cats.forEach(cat => allResults.push({...res, category: cat}));
                                seenSignatures.add(sig);
                            }
                        }
                    }
                }
            }
            processed++;
            if (processed % 10 === 0) { console.log(`✅ ${processed}/${uniqueTraders.length} traders...`); saveMarketCache(); }
        }));
    }

    allResults.sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return b.roi - a.roi;
    });

    let html = `<!DOCTYPE html><html><head><title>Backtest v11</title><style>
        body { font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; }
        h2 { color: #8b5cf6; background: #1e293b; padding: 10px; border-radius: 8px; margin-top: 40px; }
        table { width: 100%; border-collapse: collapse; background: #1e293b; }
        th, td { padding: 10px; border-bottom: 1px solid #334155; text-align: left; font-size: 0.9rem; }
        th { background: #334155; color: #38bdf8; }
        .roi-pos { color: #4ade80; font-weight: bold; }
        .roi-neg { color: #f87171; }
        .filter-tag { font-size: 0.7rem; background: #0ea5e9; padding: 2px 4px; border-radius: 4px; margin-right: 2px; }
    </style></head><body><h1>📊 Elite Backtest Results v11 (Compounding & Deep History)</h1>
    <p>Using 5,000 trades per trader. Annual ROI is based on <strong>Actual Data Span</strong>, not requested days.</p>`;

    let currentCat = "";
    allResults.forEach(r => {
        if (r.category !== currentCat) {
            if (currentCat !== "") html += `</tbody></table>`;
            currentCat = r.category;
            html += `<h2>📂 ${currentCat}</h2><table><thead><tr><th>Trader</th><th>Sample</th><th>Data Span</th><th>Trades</th><th>Hold</th><th>Total ROI</th><th>Annual ROI</th></tr></thead><tbody>`;
        }
        html += `<tr><td><strong>${r.trader}</strong><br/><a href="https://polymarket.com/profile/${r.address}" target="_blank">PM</a></td>
        <td>${r.timeframe}d</td><td>${r.dataSpanDays.toFixed(0)}d</td>
        <td>${r.executedCount}</td><td>${r.avgHoldingDays.toFixed(1)}d</td>
        <td class="${r.roi>=0?'roi-pos':'roi-neg'}">${r.roi.toFixed(2)}%</td>
        <td style="color:#fbbf24; font-weight:bold;">${r.annualRoi.toFixed(2)}%</td></tr>`;
    });
    html += `</tbody></table></body></html>`;
    fs.writeFileSync('global_backtest_report.html', html);
    console.log("✅ DONE! Report saved to global_backtest_report.html");
}

main().catch(console.error);
