
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🚀 UI-OPTIMIZED PRECISION BACKTESTER (v18)
 * Added: Sticky category navigation and collapsible Top-10+ sub-panes.
 */

const FILTERS = {
    minLeaderTradeUsd: [5, 50, 500],
    minMarket24hVol: [10000, 50000, 100000],
    maxPriceDeviation: [0.005, 0.01, 0.02]
};

const TIME_FRAMES = [730, 365, 90]; 
const STARTING_BALANCE = 1000;
const FIXED_STAKE = 10; 
const ACTIVITY_THRESHOLD_DAYS = 30; 

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

interface ReferenceData {
    netPnl: number;
}

interface BacktestResult {
    trader: string; address: string; category: string; timeframe: number;
    minTrade: number; minVol: number; maxDev: number;
    executedCount: number; wins: number; losses: number;
    roi: number; annualRoi: number;
    dataSpanDays: number; lastTradeDaysAgo: number;
    startDate: string; endDate: string; refPnl: number;
    avgHoldingDays: number;
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

async function getTraderReference(address: string): Promise<ReferenceData> {
    try {
        const url = `https://data-api.polymarket.com/profile?user=${address}`;
        const data = await fetchWithRetry(url);
        return { netPnl: parseFloat(data?.pnl || "0") };
    } catch { return { netPnl: 0 }; }
}

async function getTraderHistory(address: string): Promise<HistoricalTrade[]> {
    const cachePath = path.join(TRADER_CACHE_DIR, `${address}.json`);
    if (fs.existsSync(cachePath)) {
        const stats = fs.statSync(cachePath);
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        const ageInHours = (Date.now() - stats.mtimeMs) / (1000 * 3600);
        if (ageInHours < 24 && cached.length >= 2000) return cached;
    }

    console.log(`📡 Fetching DEEP history for ${address}...`);
    let allTrades: any[] = [];
    let offset = 0;
    const limit = 100;
    const cutoffTs = Math.floor(Date.now() / 1000) - (730 * 24 * 3600);

    while (allTrades.length < 10000) { 
        const url = `https://data-api.polymarket.com/activity?user=${address}&type=TRADE&limit=${limit}&offset=${offset}`;
        const data = await fetchWithRetry(url);
        if (!data || data.length === 0) break;
        allTrades = allTrades.concat(data);
        offset += limit;
        if (data[data.length - 1].timestamp < cutoffTs) break;
        if (data.length < limit) break;
        await delay(50);
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
            if (Object.keys(marketCache).length % 20 === 0) saveMarketCache();
            return res;
        }
    } catch {}
    return null;
}

async function runSimulation(
    traderName: string, address: string, category: string, history: HistoricalTrade[],
    timeframeDays: number, minTrade: number, minVol: number, maxDev: number, refPnl: number
): Promise<BacktestResult> {
    const nowTs = Math.floor(Date.now() / 1000);
    const cutoffTs = nowTs - (timeframeDays * 24 * 3600);
    let balance = STARTING_BALANCE;
    let wins = 0; let losses = 0; let executedCount = 0;
    const holdingDurations: number[] = [];

    const buyTrades = history.filter(t => t.side === 'BUY' && t.timestamp > cutoffTs);
    if (buyTrades.length === 0) return {} as any;

    const lastTradeTs = history[0].timestamp;
    const lastTradeDaysAgo = (nowTs - lastTradeTs) / (24 * 3600);

    const firstTradeTs = buyTrades[buyTrades.length - 1].timestamp;
    const actualSpanDays = Math.max(1, (buyTrades[0].timestamp - firstTradeTs) / (24 * 3600));

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

        if (res.toLowerCase().trim() === trade.outcome.toLowerCase().trim()) {
            wins++;
            balance += FIXED_STAKE * (1 / trade.price - 1);
        } else {
            losses++;
            balance -= FIXED_STAKE;
        }
    }

    const roi = ((balance - STARTING_BALANCE) / STARTING_BALANCE) * 100;
    const annualRoi = timeframeDays <= 365 ? roi : (roi / (timeframeDays / 365));
    const avgHoldingDays = holdingDurations.length > 0 ? holdingDurations.reduce((a,b)=>a+b,0)/holdingDurations.length : 0;

    return {
        trader: traderName.split('-')[0], address, category, timeframe: timeframeDays,
        minTrade, minVol, maxDev, executedCount, wins, losses,
        roi, annualRoi, dataSpanDays: actualSpanDays, lastTradeDaysAgo,
        startDate: new Date(firstTradeTs * 1000).toLocaleDateString(),
        endDate: new Date(buyTrades[0].timestamp * 1000).toLocaleDateString(),
        refPnl, avgHoldingDays
    };
}

function getLinks(address: string) {
    return `<div class="links">
        <a href="https://polymarket.com/profile/${address}" target="_blank" class="link-pm">PM</a>
        <a href="https://predictfolio.com/profile/${address}" target="_blank" class="link-pf">PF</a>
        <a href="https://polymarketanalytics.com/profile/${address}" target="_blank" class="link-pa">PMA</a>
    </div>`;
}

async function main() {
    console.log("🚀 STARTING UI-OPTIMIZED BACKTEST v18...");
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
    const finalResults: BacktestResult[] = [];
    let processed = 0;

    for (let i = 0; i < uniqueTraders.length; i += CONCURRENCY_LIMIT) {
        const chunk = uniqueTraders.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(chunk.map(async (t) => {
            const history = await getTraderHistory(t.address);
            if (!history || history.length === 0) return;
            const lastTradeTs = history[0].timestamp;
            const daysSinceLastTrade = (Date.now() / 1000 - lastTradeTs) / (24 * 3600);
            if (daysSinceLastTrade > ACTIVITY_THRESHOLD_DAYS) return;
            const ref = await getTraderReference(t.address);
            for (const days of TIME_FRAMES) {
                let bestForTimeframe: BacktestResult | null = null;
                for (const minTrade of FILTERS.minLeaderTradeUsd) {
                    for (const minVol of FILTERS.minMarket24hVol) {
                        for (const maxDev of FILTERS.maxPriceDeviation) {
                            const res = await runSimulation(t.name, t.address, t.cats[0], history, days, minTrade, minVol, maxDev, ref.netPnl);
                            if (res.executedCount > 0 && res.roi > 0) {
                                if (!bestForTimeframe || res.roi > bestForTimeframe.roi) bestForTimeframe = res;
                            }
                        }
                    }
                }
                if (bestForTimeframe) {
                    const res = bestForTimeframe;
                    t.cats.forEach(cat => finalResults.push({...res, category: cat}));
                }
            }
            processed++;
            if (processed % 10 === 0) console.log(`✅ ${processed}/${uniqueTraders.length} traders...`);
        }));
    }

    finalResults.sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return b.roi - a.roi;
    });

    let html = `<!DOCTYPE html><html><head><title>Elite Backtest v18</title><style>
        body { font-family: -apple-system, system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; font-size: 0.85rem; line-height: 1.4; scroll-behavior: smooth; }
        .nav-bar { position: sticky; top: 0; background: #1e293b; padding: 15px; border-radius: 8px; z-index: 1000; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; border: 1px solid #334155; }
        .nav-bar a { text-decoration: none; color: #38bdf8; font-weight: bold; font-size: 0.75rem; padding: 4px 10px; border-radius: 4px; background: #0f172a; transition: 0.2s; }
        .nav-bar a:hover { background: #38bdf8; color: #0f172a; }
        h2 { color: #8b5cf6; background: #1e293b; padding: 12px; border-radius: 8px; margin-top: 60px; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid #8b5cf6; }
        table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; margin-bottom: 10px; }
        th, td { padding: 12px; border-bottom: 1px solid #334155; text-align: left; vertical-align: top; }
        th { background: #334155; color: #38bdf8; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.05em; }
        .roi-pos { color: #4ade80; font-weight: bold; }
        .config-box { background: #0f172a; padding: 8px; border-radius: 4px; font-family: monospace; font-size: 0.7rem; color: #94a3b8; border: 1px solid #334155; white-space: pre; }
        .links a { font-size: 0.65rem; color: #38bdf8; text-decoration: none; margin-right: 5px; font-weight: bold; border: 1px solid #38bdf8; padding: 1px 4px; border-radius: 3px; }
        .verify-tag { font-size: 0.75rem; color: #94a3b8; margin-top: 4px; display: block; }
        .show-more-btn { cursor: pointer; color: #8b5cf6; font-weight: bold; display: flex; align-items: center; gap: 5px; margin: 10px 0; font-size: 0.8rem; }
        .show-more-btn:hover { text-decoration: underline; }
        .extra-rows { display: none; }
        .extra-rows.open { display: table-row-group; }
    </style></head><body>
    <h1>📊 Elite Precision Backtest v18</h1>
    <div class="nav-bar">`;
    
    categories.forEach(cat => { html += `<a href="#${cat}">${cat}</a>`; });
    html += `</div>`;

    let currentCat = "";
    let catRowCount = 0;
    
    finalResults.forEach((r, idx) => {
        if (r.category !== currentCat) {
            if (currentCat !== "") {
                if (catRowCount > 10) html += `</tbody><tbody class="extra-rows" id="extra-${currentCat}">`;
                html += `</tbody></table>`;
                if (catRowCount > 10) html += `<div class="show-more-btn" onclick="document.getElementById('extra-${currentCat}').classList.toggle('open'); this.textContent = this.textContent.includes('Show') ? '▲ Hide Others' : '▼ Show All Configurations';">▼ Show ${catRowCount - 10} More Profitable Configs</div>`;
            }
            currentCat = r.category;
            catRowCount = 0;
            html += `<h2 id="${currentCat}">📂 ${currentCat} <span style="font-size:0.8rem; color:#94a3b8;">Profitable & Active</span></h2>
            <table><thead><tr><th>Trader & Links</th><th>Performance</th><th>Simulation Details</th><th>🚀 .env Configuration</th></tr></thead>
            <tbody>`;
        }
        
        catRowCount++;
        if (catRowCount === 11) {
            html += `</tbody><tbody class="extra-rows" id="extra-${currentCat}">`;
        }

        const configStr = `USER_ADDRESSES='${r.address}'
MIN_LEADER_TRADE_USD=${r.minTrade}
MIN_MARKET_24H_VOL=${r.minVol}
MAX_PRICE_DEVIATION=${r.maxDev}`;

        html += `<tr>
            <td style="width: 200px;">
                <strong>${r.trader}</strong><br/>
                <div class="links" style="margin-top:5px;">
                    <a href="https://polymarket.com/profile/${r.address}" target="_blank">PM</a>
                    <a href="https://predictfolio.com/profile/${r.address}" target="_blank">PF</a>
                    <a href="https://polymarketanalytics.com/profile/${r.address}" target="_blank">PMA</a>
                </div>
                <span class="verify-tag">Ref PnL: <span style="color:${r.refPnl>=0?'#4ade80':'#f87171'}">$${r.refPnl.toLocaleString()}</span></span>
            </td>
            <td style="width: 150px;">
                ROI: <span class="roi-pos">${r.roi.toFixed(2)}%</span><br/>
                Annual: <span style="color:#fbbf24; font-weight:bold;">${r.annualRoi.toFixed(2)}%</span><br/>
                W/L: ${r.wins}/${r.losses}
            </td>
            <td>
                Sample: ${r.timeframe}d<br/>
                Span: ${r.dataSpanDays.toFixed(0)} days<br/>
                Trades: ${r.executedCount}<br/>
                Avg Hold: ${r.avgHoldingDays.toFixed(1)}d
            </td>
            <td>
                <div class="config-box">${configStr}</div>
            </td>
        </tr>`;
    });

    html += `</tbody></table></body></html>`;
    fs.writeFileSync('global_backtest_report.html', html);
    console.log("✅ DONE! Open global_backtest_report.html");
}

main().catch(console.error);
