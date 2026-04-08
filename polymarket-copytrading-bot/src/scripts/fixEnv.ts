
import * as fs from 'fs';
import * as path from 'path';

const ENV_PATH = path.join(__dirname, '../../.env');

const TARGET_CONFIG = {
    USER_ADDRESSES: "'0x8a4c788f043023b8b28a762216d037e9f148532b'",
    MIN_LEADER_TRADE_USD: "5",
    MIN_MARKET_24H_VOL: "10000",
    MAX_PRICE_DEVIATION: "0.005"
};

function cleanupEnv() {
    if (!fs.existsSync(ENV_PATH)) return;

    let lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
    
    // Filter out all existing occurrences of these keys to prevent duplicates
    const keysToClean = Object.keys(TARGET_CONFIG);
    lines = lines.filter(line => {
        const trimmed = line.trim();
        return !keysToClean.some(key => trimmed.startsWith(`${key}=`) || trimmed.startsWith(`${key} =`));
    });

    // Add the clean, correct values
    lines.push('\n# --- Applied Strategy: Theo5 ---');
    for (const [key, value] of Object.entries(TARGET_CONFIG)) {
        lines.push(`${key} = ${value}`);
    }

    fs.writeFileSync(ENV_PATH, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
    console.log("✅ .env cleaned and updated with Theo5 config. Duplicates removed.");
}

cleanupEnv();
