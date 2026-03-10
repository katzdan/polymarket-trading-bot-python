# Polymarket Bot | Polymarket Trading Bot | Polymarket Trading Bot - 5 min market | Polymarket Arbitrage Bot

Polymarket Bot, Polymarket Trading Bot, Polymarket 5min market Trading Bot, Polymarket Automatic Trading Bot

A high-performance, automated trading system for [Polymarket](https://polymarket.com) prediction markets. Built in Python with real-time WebSocket streaming, gasless L2 execution, and a risk-management framework suited to short-term and high-frequency environments.



<img width="1058" height="698" alt="image" src="https://github.com/user-attachments/assets/fbe3a09e-e33b-40d7-8eed-d0cfe2f54caa" />



## Contact

| Channel | Link |
|---------|------|
| **Email** | benjamin.bigdev@gmail.com |
| **Telegram** | [@BenjaminCup](https://t.me/BenjaminCup) |
| **X (Twitter)** | [@benjaminccup](https://x.com/benjaminccup) |

---

## If you'd like, I can show you a profitable bot in action through a meeting.


## Recording Video





https://github.com/user-attachments/assets/b038aa3b-e42b-4f72-ac5d-a130cdb56a9f






---
## Running Bot Screenshot

<img width="1796" height="937" alt="github-update-4-" src="https://github.com/user-attachments/assets/6b5f2782-a0f8-4333-9727-7699cd88c839" />


<img width="1796" height="930" alt="github-update-5-" src="https://github.com/user-attachments/assets/13d4b57a-7268-4102-ba28-93017026884f" />


---
## Result Screenshot

<img width="1384" height="895" alt="github-update-1" src="https://github.com/user-attachments/assets/e95f5fd9-df93-4d8f-be58-bee7568619c0" />

<img width="1489" height="920" alt="github-update-3" src="https://github.com/user-attachments/assets/33237de3-cd03-4a27-9c78-13455b925572" />



---

## **🚀 Key Features**

* **Signal + Execution Pipeline**: Combines real-time orderbook + spot prices vs strike → generates UP/DOWN signals → executes optionally.
* **Buy-Above Strategy**: Enter momentum trades when an outcome is expensive (`YES > threshold`) with risk exit and optional hedge.
* **Buy-Opposite Strategy**: Contrarian trades when one side spikes (`> threshold`) → buys the other outcome.
* **Multi-Asset Support**: Run BTC, ETH, SOL, XRP simultaneously.
* **Configurable & Extensible**: YAML + environment variable overrides (`POLYBOT5M_*`).
* **Redeem Automation**: Auto redeem positions after resolution using Builder relayer (gasless).

---

## **📊 How It Works**

### 1. **Main Pipeline (`polybot5m run`)**

Generates UP/DOWN signals every 5 minutes using:

1. **Market Discovery**: Finds active 5-minute slug (e.g., `btc-updown-5m-{epoch_ts}`) → fetches `condition_id` & asset IDs via Gamma API.
2. **Orderbook Capture**: Uses CLOB WebSocket → stores in memory for analysis.
3. **Price History**: Rolling midpoint (bid+ask)/2 over tracking window (default 60s).
4. **Reference Price**: Real-time spot from Coinbase or Binance; optional strike price scrape.
5. **Signal Engine**: Compares first-half vs second-half midpoint averages → predicts **UP** or **DOWN**.
6. **Optional Execution**: Market or limit buy at best ask per asset if credentials and `execution.enabled`.

**Flow Diagram (simplified)**:

```
Market Discovery → CLOB Orderbook → Price History → Spot vs Strike → Signal Engine → Execute
```

---

### 2. **Buy-Above Strategy (`scripts/run_5m_core.py`)**

* **Trigger**: When `best_ask > threshold` (e.g., 0.95) → market buy YES.
* **Risk Management**: Optional stop-loss (`sell_on_drop`) and hedge (`hedge_on_risk`).
* **Redeem**: Auto redeem after resolution with `redeem_delay_seconds`.
* **Multi-Cycle**: Supports multiple assets and epochs in parallel.

---

### 3. **Buy-Opposite Strategy (`scripts/test_buy_opposite_098.py`)**

* **Trigger**: When one outcome spikes above threshold (e.g., >0.98), buy the **other** outcome.
* **Use Case**: Profits from mean reversion when price spikes are temporary.
* **Multi-Cycle**: Repeat for multiple assets and epochs.

---

## **🗂 Project Layout**

```
polymarket-trading-bot-5m-v4/
├── config/
│   └── default.yaml          # All configs: bot, api, markets, entry, risk, execution, buy_above, buy_opposite
├── src/polybot5m/
│   ├── cli.py                # Main run
│   ├── entry/engine.py       # Signal computation
│   ├── data/                 # APIs, WS, orderbook, price_diff, scrape
│   └── execution/            # CLOB client, executor, redeem
├── scripts/
│   ├── run_5m_core.py        # Buy-above
│   ├── test_buy_opposite_098.py  # Buy-opposite
│   ├── run_until_resolution.py   # Full cycle
│   └── step01-12_*.py        # Step-by-step tests
└── exports/                  # Logs & activity JSONL
```

---

## **⚙ Configuration (High-Level)**

| Section             | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| **bot**             | `dry_run`, `log_level`                                 |
| **api**             | Gamma & CLOB URLs                                      |
| **markets**         | Enabled assets & intervals                             |
| **entry**           | Signal sampling, tracking window, confidence threshold |
| **risk**            | Stop-loss %, max positions                             |
| **execution**       | API keys, private key, order type, buy/sell style      |
| **buy_above**       | Threshold, amount, cycles, risk, hedge                 |
| **buy_opposite**    | Threshold, amount, offset, cycles                      |
| **reference_price** | Coinbase/Binance, optional strike scrape               |

> ⚡ **Tip**: Override any config with `POLYBOT5M_*` environment variables.

---

## **💰 How It Can Make Money**

1. **Main Run**: Predicts 5-minute market outcomes better than average → executes trades.
2. **Buy-Above**: Exploits momentum when YES price is high; profits if outcome wins more often than implied by price.
3. **Buy-Opposite**: Profits from mean-reversion on price spikes.

> ⚠️ **Risk Note**: All strategies are directional speculation. Losses can occur if prediction is wrong or price slips.

---

## **🏁 Beginner Workflow (WORKFLOW_BEGINNER.md)**

1. **Setup**:

   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -e .
   ```

   Optional: Playwright for strike scraping.

2. **Verify Config**: Run step scripts (`step01_config.py`, `step02_slug.py`) without network keys.

3. **Dry-Run Main Pipeline**:

   ```bash
   .venv/bin/polybot5m run --dry-run
   .venv/bin/python scripts/run_until_resolution.py --cycles 1
   ```

4. **Dry-Run Strategy Scripts**:

   ```bash
   .venv/bin/python scripts/run_5m_core.py --dry-run --cycles 1
   .venv/bin/python scripts/test_buy_opposite_098.py --dry-run --cycles 1
   ```

5. **Add Credentials**: `.env` file with CLOB & Builder keys for execution/redeem.

6. **First Live Run**: Start with `dry_run=False`, small amount, one cycle → verify signals and execution.

> 📌 **Quick Reference Table**: Install → signals → dry-run strategies → add credentials → first live run.

---

## **💻 Running It**

```bash
# Main pipeline
.venv/bin/polybot5m run
.venv/bin/polybot5m -c config/default.yaml run

# Buy-above strategy
.venv/bin/python scripts/run_5m_core.py --dry-run --cycles 1

# Buy-opposite strategy
.venv/bin/python scripts/test_buy_opposite_098.py --dry-run --cycles 5

# Full cycle until resolution
.venv/bin/python scripts/run_until_resolution.py
```

> Ensure API keys and private key are set for execution; redeem uses Builder relayer keys.

---

## **📌 Summary**

| Aspect            | polymarket-trading-bot-5m-v4                                         |
| ----------------- | -------------------------------------------------------------------- |
| **Role**          | Signal + execution bot for 5m crypto UP/DOWN markets                 |
| **Main Run**      | Orderbook + spot vs strike → UP/DOWN signal → optional execution     |
| **Strategies**    | Buy-above (momentum + risk exit), Buy-opposite (contrarian)          |
| **Markets**       | BTC, ETH, SOL, XRP (configurable)                                    |
| **Data Sources**  | Gamma, CLOB WS, Coinbase/Binance WS, optional strike scrape          |
| **Config**        | YAML + `POLYBOT5M_*` env overrides                                   |
| **Beginner Path** | Clone → setup → dry-run → try strategies → add keys → first live run |

> With **polymarket-trading-bot-5m-v4**, you get a **full 5-minute crypto bot**: signal generation, automated execution, risk management, and redeem—ready to start small and scale confidently.

---

If you want, I can also make a **visual diagram for the workflow** (main pipeline + strategies + redeem) to add at the top of README. This usually helps **new traders immediately grasp the bot logic**.

Do you want me to create that diagram next?

