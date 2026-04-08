
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const MARKET_CACHE_FILE = './market_data_cache.json';
const TOP_TRADERS_FILE = 'top_traders_by_category.json';
const TRADER_CACHE_DIR = './trader_data_cache';

let marketCache: any = {};
if (fs.existsSync(MARKET_CACHE_FILE)) {
    marketCache = JSON.parse(fs.readFileSync(MARKET_CACHE_FILE, 'utf8'));
}

async function fetchWithRetry(url: string, retries = 2): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.get(url, { timeout: 10000 });
            return res.data;
        } catch (e) {
            if (i === retries - 1) return null;
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

async function repair() {
    console.log("🛠️ REPAIRING VOLUME CACHE FOR TOP TRADERS...");
    const topTradersData = JSON.parse(fs.readFileSync(TOP_TRADERS_FILE, 'utf8'));
    const uniqueConditions = new Set<string>();

    // 1. Gather all conditions used by top 100 traders
    Object.keys(topTradersData).forEach(cat => {
        topTradersData[cat].slice(0, 100).forEach((t: any) => {
            const historyPath = path.join(TRADER_CACHE_DIR, `${t.proxyWallet.toLowerCase()}.json`);
            if (fs.existsSync(historyPath)) {
                const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
                history.forEach((tr: any) => uniqueConditions.add(tr.conditionId));
            }
        });
    });

    const conditions = Array.from(uniqueConditions).filter(c => !marketCache[c] || marketCache[c].totalVol === 0);
    console.log(`📊 Found ${conditions.length} conditions needing volume repair.`);

    let count = 0;
    const CHUNK_SIZE = 10;
    for (let i = 0; i < conditions.length; i += CHUNK_SIZE) {
        const chunk = conditions.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(async (c) => {
            const gUrl = `https://gamma-api.polymarket.com/markets?condition_id=${c}`;
            const gData = await fetchWithRetry(gUrl);
            if (gData && Array.isArray(gData)) {
                const exact = gData.find(m => m.conditionId?.toLowerCase() === c.toLowerCase());
                if (exact && marketCache[c]) {
                    marketCache[c].totalVol = parseFloat(exact.volume || "0");
                }
            }
        }));
        count += chunk.length;
        if (count % 100 === 0) {
            console.log(`✅ Repaired ${count}/${conditions.length}...`);
            fs.writeFileSync(MARKET_CACHE_FILE, JSON.stringify(marketCache));
        }
    }
    fs.writeFileSync(MARKET_CACHE_FILE, JSON.stringify(marketCache));
    console.log("✅ VOLUME REPAIR COMPLETE!");
}

repair();
