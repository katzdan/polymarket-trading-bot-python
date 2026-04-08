
import * as fs from 'fs';
import * as path from 'path';

const MARKET_CACHE_FILE = './market_data_cache.json';
const THEO5_ADDRESS = '0x8a4c788f043023b8b28a762216d037e9f148532b';
const TRADER_CACHE_DIR = './trader_data_cache';

function verify() {
    console.log("🔍 CACHE VERIFICATION REPORT");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // 1. Check Market Cache
    if (fs.existsSync(MARKET_CACHE_FILE)) {
        const marketCache = JSON.parse(fs.readFileSync(MARKET_CACHE_FILE, 'utf8'));
        const keys = Object.keys(marketCache);
        console.log(`Market Cache: ${keys.length} entries`);
        
        // Count entries with volume
        const withVol = keys.filter(k => marketCache[k].totalVol > 0).length;
        console.log(`Entries with TotalVol > 0: ${withVol}`);
        
        // Sample one entry
        if (keys.length > 0) {
            console.log("Sample Entry:", JSON.stringify(marketCache[keys[0]], null, 2));
        }
    }

    // 2. Check Theo5 Cache
    const theoPath = path.join(TRADER_CACHE_DIR, `${THEO5_ADDRESS}.json`);
    if (fs.existsSync(theoPath)) {
        const history = JSON.parse(fs.readFileSync(theoPath, 'utf8'));
        console.log(`Theo5 History: ${history.length} trades`);
        if (history.length > 0) {
            console.log("First Trade:", history[0].market, "Size:", history[0].usdcSize);
        }
    }
}

verify();
