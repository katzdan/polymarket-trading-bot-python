
import * as fs from 'fs';
import * as path from 'path';

const ENV_PATH = path.join(__dirname, '../../.env');

const NEW_CONFIG = {
    USER_ADDRESSES: '',
    MIN_LEADER_TRADE_USD: '',
    MIN_MARKET_24H_VOL: '',
    MAX_PRICE_DEVIATION: ''
};

function updateEnv() {
    if (!fs.existsSync(ENV_PATH)) {
        console.log("Creating new .env from scratch...");
        const content = Object.entries(NEW_CONFIG).map(([k, v]) => `${k}=${v}`).join('\n');
        fs.writeFileSync(ENV_PATH, content);
        return;
    }

    let content = fs.readFileSync(ENV_PATH, 'utf8');
    const lines = content.split('\n');
    
    for (const [key, value] of Object.entries(NEW_CONFIG)) {
        const index = lines.findIndex(line => line.startsWith(`${key}=`));
        if (index !== -1) {
            lines[index] = `${key}=${value}`;
        } else {
            lines.push(`${key}=${value}`);
        }
    }

    fs.writeFileSync(ENV_PATH, lines.join('\n'));
    console.log("✅ .env file updated successfully with Theo5 config.");
}

updateEnv();
