# 🛡️ Pilot Trading Filters (Capital Protection)

This document details the refined capital protection filters implemented for the pilot budget ($1,000 start, $5/trade) to protect capital from market noise and high slippage.

## 🚀 Overview

The pilot trading strategy uses a conservative budget and requires high-conviction trades in liquid markets. To achieve this, four specific filters are integrated into the execution pipeline and validated via extensive backtesting.

---

## 🔍 The Four Core Filters

### 1. Dusting Filter (`MIN_LEADER_TRADE_USD`)
- **Goal**: Skips "noise" trades from whales (e.g., $0.10–$50) that might be used to test liquidity or "dust" followers.
- **Backtest Winner**: **$5.00** (Captures consistent smaller moves) or **$500.00** (High conviction only).
- **Default**: Only follows trades where the leader invests at least **$5.00**.

### 2. Liquidity Filter (`MIN_MARKET_24H_VOL`)
- **Goal**: Ensures the bot only trades in high-volume markets to guarantee deep liquidity and tight bid-ask spreads.
- **Implementation**: During live trading, it checks the real-time 24h Gamma volume. During backtesting, it uses the **Leader Trade Size Proxy** (Leader must trade > 1% of the volume filter).
- **Default**: Skips markets with less than **$10,000** in volume.

### 3. Slippage Guard (`MAX_PRICE_DEVIATION`)
- **Goal**: Prevents the bot from "chasing" a price pump caused by a leader's large order.
- **Mechanism**: The bot fetches the current order book and compares the best available price to the leader's execution price.
- **Default**: Cancels the trade if the price deviates by more than **0.5%** (0.005).

### 4. Risk/Reward Ceiling (`MAX_COPY_PRICE`)
- **Goal**: Avoids "Inverse Bond" scenarios where you risk $0.95 to make $0.05.
- **Logic**: Skips any trade where the entry price is above **$0.92**.
- **Default**: **0.92**.

---

## 📈 Backtest Validation

The filters were tested against **760 unique traders** across 10 categories.

### **Key Finding: The "Theo4" Balanced Profile**
- **Category**: Politics
- **ROI**: 202% (2-year period)
- **Annual ROI**: 101%
- **Avg Hold Time**: 18.5 days
- **Optimal Config**: $5 Min Trade, $10k Min Vol, 0.5% Max Dev.

---

## 🛠️ Configuration

Enable these filters in your `.env`:

```bash
MIN_LEADER_TRADE_USD = 5.0
MIN_MARKET_24H_VOL = 10000.0
MAX_PRICE_DEVIATION = 0.005
MAX_COPY_PRICE = 0.92
```
