import axios from 'axios';
import { ENV } from '../config/env';
import Logger from './logger';

/**
 * Notifier utility for sending alerts to Telegram and Discord.
 */
class Notifier {
    /**
     * Sends a message to configured notification channels.
     * @param message - The message to send.
     */
    static async notify(message: string): Promise<void> {
        // Send to Telegram if configured
        if (ENV.TELEGRAM_TOKEN && ENV.TELEGRAM_CHAT_ID) {
            try {
                const url = `https://api.telegram.org/bot${ENV.TELEGRAM_TOKEN}/sendMessage`;
                await axios.post(url, {
                    chat_id: ENV.TELEGRAM_CHAT_ID,
                    text: message,
                    parse_mode: 'Markdown',
                });
            } catch (error) {
                Logger.error(`Error sending Telegram notification: ${error}`);
            }
        }

        // Send to Discord if configured
        if (ENV.DISCORD_WEBHOOK_URL) {
            try {
                await axios.post(ENV.DISCORD_WEBHOOK_URL, {
                    content: message,
                });
            } catch (error) {
                Logger.error(`Error sending Discord notification: ${error}`);
            }
        }
    }

    /**
     * Notify about service startup.
     */
    static async notifyStartup(traders: string[], wallet: string): Promise<void> {
        const maskedWallet = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
        const message = `🚀 *Polymarket Bot Started*\n\n` +
            `💼 *Wallet:* \`${maskedWallet}\`\n` +
            `📊 *Tracking:* ${traders.length} trader(s)\n` +
            `🕒 *Time:* ${new Date().toLocaleString()}`;
        await this.notify(message);
    }

    /**
     * Notify about a trade action (BUY/SELL).
     */
    static async notifyTrade(side: string, amount: number, price: number, market: string, trader: string): Promise<void> {
        const emoji = side === 'BUY' ? '🟢' : '🔴';
        const maskedTrader = `${trader.slice(0, 6)}...${trader.slice(-4)}`;
        const message = `${emoji} *Trade Executed: ${side}*\n\n` +
            `📈 *Market:* ${market}\n` +
            `💰 *Amount:* $${amount.toFixed(2)}\n` +
            `🏷️ *Price:* $${price.toFixed(4)}\n` +
            `👤 *Copying:* \`${maskedTrader}\``;
        await this.notify(message);
    }

    /**
     * Notify about a filtered/skipped trade.
     */
    static async notifyFiltered(reason: string, market: string, trader: string, amount?: number): Promise<void> {
        const maskedTrader = `${trader.slice(0, 6)}...${trader.slice(-4)}`;
        let message = `⚠️ *Trade Ignored*\n\n` +
            `📈 *Market:* ${market}\n` +
            `👤 *Trader:* \`${maskedTrader}\`\n` +
            `🚫 *Reason:* ${reason}`;
        
        if (amount) {
            message += `\n💰 *Leader Amount:* $${amount.toFixed(2)}`;
        }
        
        await this.notify(message);
    }
}

export default Notifier;
