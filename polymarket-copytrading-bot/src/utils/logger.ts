/**
 * Logging utility module.
 * This module provides structured logging with Winston, console output with colors, and various logging methods for different types of information.
 */

import chalk from 'chalk';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';

/**
 * Enum for log levels.
 * @enum {number}
 */
enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    CRITICAL = 4
}

/**
 * Logger class for handling application logging.
 * @class Logger
 */
class Logger {
    private static logger: winston.Logger;
    private static minLevel: LogLevel;

    static {
        // Get minimum log level from env, default to INFO
        const levelEnv = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
        this.minLevel = LogLevel[levelEnv as keyof typeof LogLevel] ?? LogLevel.INFO;

        const logsDir = path.join(process.cwd(), 'logs');

        // Custom format for console with colors
        const consoleFormat = winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
                const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                return `${timestamp} ${level}: ${message}${metaStr}`;
            })
        );

        // JSON format for files
        const fileFormat = winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        );

        this.logger = winston.createLogger({
            level: LogLevel[this.minLevel].toLowerCase(),
            levels: {
                debug: LogLevel.DEBUG,
                info: LogLevel.INFO,
                warn: LogLevel.WARN,
                error: LogLevel.ERROR,
                critical: LogLevel.CRITICAL
            },
            transports: [
                // Console transport with colors
                new winston.transports.Console({
                    format: consoleFormat
                }),
                // Daily rotate file transport with JSON
                new DailyRotateFile({
                    filename: 'bot-%DATE%.log',
                    dirname: logsDir,
                    datePattern: 'YYYY-MM-DD',
                    maxSize: '20m', // 20MB
                    maxFiles: '14d', // Keep 14 days
                    format: fileFormat
                })
            ]
        });
    }

    private static shouldLog(level: LogLevel): boolean {
        return level >= this.minLevel;
    }

    private static formatAddress(address: string): string {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    private static maskAddress(address: string): string {
        // Show 0x and first 4 chars, mask middle, show last 4 chars
        return `${address.slice(0, 6)}${'*'.repeat(34)}${address.slice(-4)}`;
    }

    /**
     * Logs a header message with formatting.
     * @param {string} title - The title to display.
     */
    static header(title: string) {
        if (this.shouldLog(LogLevel.INFO)) {
            console.log('\n' + chalk.cyan('━'.repeat(70)));
            console.log(chalk.cyan.bold(`  ${title}`));
            console.log(chalk.cyan('━'.repeat(70)) + '\n');
        }
        this.logger.info('Header displayed', { title, type: 'header' });
    }

    /**
     * Logs an info message.
     * @param {string} message - The message to log.
     * @param {any} [meta] - Additional metadata.
     */
    static info(message: string, meta?: any) {
        if (this.shouldLog(LogLevel.INFO)) {
            console.log(chalk.blue('ℹ'), message);
        }
        this.logger.info(message, meta);
    }

    /**
     * Logs a success message.
     * @param {string} message - The message to log.
     * @param {any} [meta] - Additional metadata.
     */
    static success(message: string, meta?: any) {
        if (this.shouldLog(LogLevel.INFO)) {
            console.log(chalk.green('✓'), message);
        }
        this.logger.info(message, { ...meta, type: 'success' });
    }

    /**
     * Logs a warning message.
     * @param {string} message - The message to log.
     * @param {any} [meta] - Additional metadata.
     */
    static warning(message: string, meta?: any) {
        if (this.shouldLog(LogLevel.WARN)) {
            console.log(chalk.yellow('⚠'), message);
        }
        this.logger.warn(message, meta);
    }

    /**
     * Logs an error message.
     * @param {string} message - The message to log.
     * @param {any} [meta] - Additional metadata.
     */
    static error(message: string, meta?: any) {
        if (this.shouldLog(LogLevel.ERROR)) {
            console.log(chalk.red('✗'), message);
        }
        this.logger.error(message, meta);
    }

    /**
     * Logs a debug message.
     * @param {string} message - The message to log.
     * @param {any} [meta] - Additional metadata.
     */
    static debug(message: string, meta?: any) {
        if (this.shouldLog(LogLevel.DEBUG)) {
            console.log(chalk.gray('🐛'), message);
        }
        this.logger.debug(message, meta);
    }

    /**
     * Logs a critical message.
     * @param {string} message - The message to log.
     * @param {any} [meta] - Additional metadata.
     */
    static critical(message: string, meta?: any) {
        if (this.shouldLog(LogLevel.CRITICAL)) {
            console.log(chalk.red.bold('🚨'), message);
        }
        this.logger.log('critical', message, meta);
    }

    /**
     * Logs trade information.
     * @param {string} traderAddress - The trader's address.
     * @param {string} action - The action performed.
     * @param {any} details - Trade details.
     */
    static trade(traderAddress: string, action: string, details: any) {
        if (this.shouldLog(LogLevel.INFO)) {
            console.log('\n' + chalk.magenta('─'.repeat(70)));
            console.log(chalk.magenta.bold('📊 NEW TRADE DETECTED'));
            console.log(chalk.gray(`Trader: ${this.formatAddress(traderAddress)}`));
            console.log(chalk.gray(`Action: ${chalk.white.bold(action)}`));
            if (details.asset) {
                console.log(chalk.gray(`Asset:  ${this.formatAddress(details.asset)}`));
            }
            if (details.side) {
                const sideColor = details.side === 'BUY' ? chalk.green : chalk.red;
                console.log(chalk.gray(`Side:   ${sideColor.bold(details.side)}`));
            }
            if (details.amount) {
                console.log(chalk.gray(`Amount: ${chalk.yellow(`$${details.amount}`)}`));
            }
            if (details.price) {
                console.log(chalk.gray(`Price:  ${chalk.cyan(details.price)}`));
            }
            if (details.eventSlug || details.slug) {
                // Use eventSlug for the correct market URL format
                const slug = details.eventSlug || details.slug;
                const marketUrl = `https://polymarket.com/event/${slug}`;
                console.log(chalk.gray(`Market: ${chalk.blue.underline(marketUrl)}`));
            }
            if (details.transactionHash) {
                const txUrl = `https://polygonscan.com/tx/${details.transactionHash}`;
                console.log(chalk.gray(`TX:     ${chalk.blue.underline(txUrl)}`));
            }
            console.log(chalk.magenta('─'.repeat(70)) + '\n');
        }

        // Structured logging
        this.logger.info('New trade detected', {
            traderAddress: this.formatAddress(traderAddress),
            action,
            ...details,
            type: 'trade'
        });
    }

    /**
     * Logs balance information.
     * @param {number} myBalance - The user's balance.
     * @param {number} traderBalance - The trader's balance.
     * @param {string} traderAddress - The trader's address.
     */
    static balance(myBalance: number, traderBalance: number, traderAddress: string) {
        if (this.shouldLog(LogLevel.INFO)) {
            console.log(chalk.gray('Capital (USDC + Positions):'));
            console.log(
                chalk.gray(`  Your total capital:   ${chalk.green.bold(`$${myBalance.toFixed(2)}`)}`)
            );
            console.log(
                chalk.gray(
                    `  Trader total capital: ${chalk.blue.bold(`$${traderBalance.toFixed(2)}`)} (${this.formatAddress(traderAddress)})`
                )
            );
        }
        this.logger.info('Balance information displayed', {
            myBalance,
            traderBalance,
            traderAddress: this.formatAddress(traderAddress),
            type: 'balance'
        });
    }

    /**
     * Logs order result.
     * @param {boolean} success - Whether the order was successful.
     * @param {string} message - The result message.
     * @param {any} [meta] - Additional metadata.
     */
    static orderResult(success: boolean, message: string, meta?: any) {
        if (success) {
            if (this.shouldLog(LogLevel.INFO)) {
                console.log(chalk.green('✓'), chalk.green.bold('Order executed:'), message);
            }
            this.logger.info('Order executed successfully', { message, ...meta, type: 'order_success' });
        } else {
            if (this.shouldLog(LogLevel.ERROR)) {
                console.log(chalk.red('✗'), chalk.red.bold('Order failed:'), message);
            }
            this.logger.error('Order execution failed', { message, ...meta, type: 'order_failed' });
        }
    }

    /**
     * Logs monitoring status.
     * @param {number} traderCount - The number of traders being monitored.
     */
    static monitoring(traderCount: number) {
        const timestamp = new Date().toLocaleTimeString();
        if (this.shouldLog(LogLevel.INFO)) {
            console.log(
                chalk.dim(`[${timestamp}]`),
                chalk.cyan('👁️  Monitoring'),
                chalk.yellow(`${traderCount} trader(s)`)
            );
        }
        this.logger.info('Monitoring status', { traderCount, type: 'monitoring' });
    }

    /**
     * Logs startup information.
     * @param {string[]} traders - List of trader addresses.
     * @param {string} myWallet - The user's wallet address.
     */
    static startup(traders: string[], myWallet: string) {
        if (this.shouldLog(LogLevel.INFO)) {
            console.log('\n');
            // ASCII Art Logo with gradient colors
            console.log(chalk.cyan('  ____       _        ____                 '));
            console.log(chalk.cyan(' |  _ \\ ___ | |_   _ / ___|___  _ __  _   _ '));
            console.log(chalk.cyan.bold(" | |_) / _ \\| | | | | |   / _ \\| '_ \\| | | |"));
            console.log(chalk.magenta.bold(' |  __/ (_) | | |_| | |__| (_) | |_) | |_| |'));
            console.log(chalk.magenta(' |_|   \\___/|_|\\__, |\\____\\___/| .__/ \\__, |'));
            console.log(chalk.magenta('               |___/            |_|    |___/ '));
            console.log(chalk.gray('               Copy the best, automate success\n'));

            console.log(chalk.cyan('━'.repeat(70)));
            console.log(chalk.cyan('📊 Tracking Traders:'));
            traders.forEach((address, index) => {
                console.log(chalk.gray(`   ${index + 1}. ${address}`));
            });
            console.log(chalk.cyan(`\n💼 Your Wallet:`));
            console.log(chalk.gray(`   ${this.maskAddress(myWallet)}\n`));
        }
        this.logger.info('Application startup', {
            traders,
            myWallet: this.maskAddress(myWallet),
            type: 'startup'
        });
    }

    /**
     * Logs database connection information.
     * @param {string[]} traders - List of trader addresses.
     * @param {number[]} counts - Trade counts for each trader.
     */
    static dbConnection(traders: string[], counts: number[]) {
        if (this.shouldLog(LogLevel.INFO)) {
            console.log('\n' + chalk.cyan('📦 Database Status:'));
            traders.forEach((address, index) => {
                const countStr = chalk.yellow(`${counts[index]} trades`);
                console.log(chalk.gray(`   ${this.formatAddress(address)}: ${countStr}`));
            });
            console.log('');
        }
        const traderData = traders.map((addr, i) => ({ address: this.formatAddress(addr), trades: counts[i] }));
        this.logger.info('Database connection status', { traders: traderData, type: 'db_connection' });
    }

    /**
     * Logs a separator line.
     */
    static separator() {
        if (this.shouldLog(LogLevel.DEBUG)) {
            console.log(chalk.dim('─'.repeat(70)));
        }
        // No structured log for separator
    }

    private static lastWaitLog = 0;
    private static lastConsoleWaitLog = 0;
    private static spinnerFrames = ['⏳', '⌛', '⏳'];
    private static spinnerIndex = 0;

    /**
     * Logs waiting status.
     * @param {number} traderCount - The number of traders.
     * @param {string} [extraInfo] - Extra information.
     */
    static waiting(traderCount: number, extraInfo?: string) {
        const now = Date.now();
        const timestamp = new Date().toLocaleTimeString();
        const spinner = this.spinnerFrames[this.spinnerIndex % this.spinnerFrames.length];
        this.spinnerIndex++;

        const message = extraInfo
            ? `${spinner} Waiting for trades from ${traderCount} trader(s)... (${extraInfo})`
            : `${spinner} Waiting for trades from ${traderCount} trader(s)...`;

        // 🚀 PRODUCTION OPTIMIZATION: Only log to console/PM2 every 15 minutes to avoid bloat
        // New trades and errors will still log immediately.
        if (now - this.lastConsoleWaitLog > 15 * 60 * 1000) {
            console.log(chalk.dim(`[${timestamp}] `) + chalk.cyan(message));
            this.lastConsoleWaitLog = now;
        }

        // Keep the debug file log as is (once every 10s is fine for files)
        if (now - this.lastWaitLog > 10000) {
            this.logger.debug('Waiting for trades', { traderCount, extraInfo, type: 'waiting' });
            this.lastWaitLog = now;
        }
    }

    /**
     * Clears the current line.
     */
    static clearLine() {
        process.stdout.write('\r' + ' '.repeat(100) + '\r');
    }

    /**
     * Logs user's positions.
     * @param {string} wallet - The wallet address.
     * @param {number} count - Number of positions.
     * @param {any[]} topPositions - Top positions.
     * @param {number} overallPnl - Overall P&L.
     * @param {number} totalValue - Total value.
     * @param {number} initialValue - Initial value.
     * @param {number} currentBalance - Current balance.
     */
    static myPositions(
        wallet: string,
        count: number,
        topPositions: any[],
        overallPnl: number,
        totalValue: number,
        initialValue: number,
        currentBalance: number
    ) {
        if (this.shouldLog(LogLevel.INFO)) {
            console.log('\n' + chalk.magenta.bold('💼 YOUR POSITIONS'));
            console.log(chalk.gray(`   Wallet: ${this.formatAddress(wallet)}`));
            console.log('');

            // Show balance and portfolio overview
            const balanceStr = chalk.yellow.bold(`$${currentBalance.toFixed(2)}`);
            const totalPortfolio = currentBalance + totalValue;
            const portfolioStr = chalk.cyan.bold(`$${totalPortfolio.toFixed(2)}`);

            console.log(chalk.gray(`   💰 Available Cash:    ${balanceStr}`));
            console.log(chalk.gray(`   📊 Total Portfolio:   ${portfolioStr}`));

            if (count === 0) {
                console.log(chalk.gray(`\n   No open positions`));
            } else {
                const countStr = chalk.green(`${count} position${count > 1 ? 's' : ''}`);
                const pnlColor = overallPnl >= 0 ? chalk.green : chalk.red;
                const pnlSign = overallPnl >= 0 ? '+' : '';
                const profitStr = pnlColor.bold(`${pnlSign}${overallPnl.toFixed(1)}%`);
                const valueStr = chalk.cyan(`$${totalValue.toFixed(2)}`);
                const initialStr = chalk.gray(`$${initialValue.toFixed(2)}`);

                console.log('');
                console.log(chalk.gray(`   📈 Open Positions:    ${countStr}`));
                console.log(chalk.gray(`      Invested:          ${initialStr}`));
                console.log(chalk.gray(`      Current Value:     ${valueStr}`));
                console.log(chalk.gray(`      Profit/Loss:       ${profitStr}`));

                // Show top positions
                if (topPositions.length > 0) {
                    console.log(chalk.gray(`\n   🔝 Top Positions:`));
                    topPositions.forEach((pos: any) => {
                        const pnlColor = pos.percentPnl >= 0 ? chalk.green : chalk.red;
                        const pnlSign = pos.percentPnl >= 0 ? '+' : '';
                        const avgPrice = pos.avgPrice || 0;
                        const curPrice = pos.curPrice || 0;
                        console.log(
                            chalk.gray(
                                `      • ${pos.outcome} - ${pos.title.slice(0, 45)}${pos.title.length > 45 ? '...' : ''}`
                            )
                        );
                        console.log(
                            chalk.gray(
                                `        Value: ${chalk.cyan(`$${pos.currentValue.toFixed(2)}`)} | PnL: ${pnlColor(`${pnlSign}${pos.percentPnl.toFixed(1)}%`)}`
                            )
                        );
                        console.log(
                            chalk.gray(
                                `        Bought @ ${chalk.yellow(`${(avgPrice * 100).toFixed(1)}¢`)} | Current @ ${chalk.yellow(`${(curPrice * 100).toFixed(1)}¢`)}`
                            )
                        );
                    });
                }
            }
            console.log('');
        }
        this.logger.info('My positions displayed', {
            wallet: this.formatAddress(wallet),
            count,
            overallPnl,
            totalValue,
            initialValue,
            currentBalance,
            topPositions: topPositions.map(pos => ({
                outcome: pos.outcome,
                title: pos.title,
                currentValue: pos.currentValue,
                percentPnl: pos.percentPnl,
                avgPrice: pos.avgPrice,
                curPrice: pos.curPrice
            })),
            type: 'my_positions'
        });
    }

    /**
     * Logs traders' positions.
     * @param {string[]} traders - List of traders.
     * @param {number[]} positionCounts - Position counts.
     * @param {any[][]} [positionDetails] - Position details.
     * @param {number[]} [profitabilities] - Profitabilities.
     */
    static tradersPositions(
        traders: string[],
        positionCounts: number[],
        positionDetails?: any[][],
        profitabilities?: number[]
    ) {
        if (this.shouldLog(LogLevel.INFO)) {
            console.log('\n' + chalk.cyan("📈 TRADERS YOU'RE COPYING"));
            traders.forEach((address, index) => {
                const count = positionCounts[index];
                const countStr =
                    count > 0
                        ? chalk.green(`${count} position${count > 1 ? 's' : ''}`)
                        : chalk.gray('0 positions');

                // Add profitability if available
                let profitStr = '';
                if (profitabilities && profitabilities[index] !== undefined && count > 0) {
                    const pnl = profitabilities[index];
                    const pnlColor = pnl >= 0 ? chalk.green : chalk.red;
                    const pnlSign = pnl >= 0 ? '+' : '';
                    profitStr = ` | ${pnlColor.bold(`${pnlSign}${pnl.toFixed(1)}%`)}`;
                }

                console.log(chalk.gray(`   ${this.formatAddress(address)}: ${countStr}${profitStr}`));

                // Show position details if available
                if (positionDetails && positionDetails[index] && positionDetails[index].length > 0) {
                    positionDetails[index].forEach((pos: any) => {
                        const pnlColor = pos.percentPnl >= 0 ? chalk.green : chalk.red;
                        const pnlSign = pos.percentPnl >= 0 ? '+' : '';
                        const avgPrice = pos.avgPrice || 0;
                        const curPrice = pos.curPrice || 0;
                        console.log(
                            chalk.gray(
                                `      • ${pos.outcome} - ${pos.title.slice(0, 40)}${pos.title.length > 40 ? '...' : ''}`
                            )
                        );
                        console.log(
                            chalk.gray(
                                `        Value: ${chalk.cyan(`$${pos.currentValue.toFixed(2)}`)} | PnL: ${pnlColor(`${pnlSign}${pos.percentPnl.toFixed(1)}%`)}`
                            )
                        );
                        console.log(
                            chalk.gray(
                                `        Bought @ ${chalk.yellow(`${(avgPrice * 100).toFixed(1)}¢`)} | Current @ ${chalk.yellow(`${(curPrice * 100).toFixed(1)}¢`)}`
                            )
                        );
                    });
                }
            });
            console.log('');
        }
        const traderData = traders.map((addr, i) => ({
            address: this.formatAddress(addr),
            positionCount: positionCounts[i],
            profitability: profitabilities ? profitabilities[i] : undefined,
            positions: positionDetails && positionDetails[i] ? positionDetails[i].map(pos => ({
                outcome: pos.outcome,
                title: pos.title,
                currentValue: pos.currentValue,
                percentPnl: pos.percentPnl,
                avgPrice: pos.avgPrice,
                curPrice: pos.curPrice
            })) : []
        }));
        this.logger.info('Traders positions displayed', { traders: traderData, type: 'traders_positions' });
    }
}

export default Logger;
