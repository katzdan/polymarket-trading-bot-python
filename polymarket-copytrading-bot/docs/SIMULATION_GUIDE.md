# 🧪 Simulation and Backtesting Guide

This guide covers the advanced simulation tools used to verify copy-trading strategies before going live.

## 📊 1. Multi-Strategy Backtester (v10)

The v10 backtester is designed for massive scale and high-fidelity historical analysis.

### **Key Features**
- **Scale**: Simulates top 100 traders in each of 10 categories (760+ unique traders).
- **High Performance**: Uses a persistent `market_data_cache.json` to minimize API overhead.
- **Advanced Metrics**:
    - **Annual ROI**: Corrected for multi-year timeframes.
    - **Avg Holding Time**: Calculates the duration from entry to market resolution.
    - **Liquidity Proxy**: Uses leader trade size to estimate historical liquidity.
- **Reporting**: Generates a rich, sortable HTML report (`global_backtest_report.html`) grouped by category.

### **Usage**
```bash
cd polymarket-copytrading-bot
npx ts-node src/scripts/multiBacktest.ts
```

---

## 🧪 2. Real-Time Dry-Run Profitability

The Dry-Run script allows you to calculate hypothetical USD profit based on the **most recent 50 trades** of the leader configured in your `.env`.

### **Why use it?**
While the backtester looks at 2 years of history, the dry-run looks at the "now." It tells you how your current filters would have performed over the last week or month.

### **Usage**
```bash
cd polymarket-copytrading-bot
npx ts-node src/scripts/dryRunProfitability.ts
```

---

## 🔍 3. Interpreting Results

- **Executed Count**: How many trades actually passed your filters. If this is 0, your filters (e.g., Min Volume) are too strict.
- **W/L Ratio**: The primary indicator of a leader's consistency.
- **Avg Hold**: Important for capital management. If a trader holds for 100+ days, your capital will be locked up for that duration.
- **Annual ROI**: The projected return over a 365-day period.

---

## 💡 Pro Tips
1. **Deduplicate**: The backtester automatically hides redundant filter combinations to focus on unique performance profiles.
2. **Verify**: Use the links in the HTML report to view the trader's profile on **Predictfolio** or **PolymarketAnalytics**.
