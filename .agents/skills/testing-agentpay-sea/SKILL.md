---
name: testing-agentpay-sea
description: How to run and end-to-end test the AgentPay SEA dashboard + Express API locally (demo mode), including fault injection for error-handling paths.
---

# Testing AgentPay SEA locally

## Running the app
- `npm install`, then `npm run dev` starts both processes via `concurrently -k` (API on :8787, Vite on :5173; Vite proxies `/api` to :8787).
- Demo mode is the default (no secrets, no Solana keys). Do NOT attempt real Devnet settlement — it needs a funded `SERVER_PRIVATE_KEY`, `MERCHANT_WALLET`, `USDC_MINT`, `RPC_URL`.
- Node 20.18 works even though Vite warns it wants 20.19+.

## Important: killing only the API
`npm run dev` uses `concurrently -k`, so killing the API child also kills Vite. To test "API down" states, run the two halves separately:
```
npm run dev:web    # Vite :5173
npm run dev:server # Express :8787
```
Then `pkill -f "server/local.ts"` stops only the API and the dashboard stays up.
Note: such a `pkill` may also terminate the shell that launched it; relaunch with `(nohup npm run dev:server > /tmp/api.log 2>&1 &)` in a fresh call and check `/tmp/api.log` for `AgentPay API listening`.
With the API down the Vite proxy answers `/api/config` with **HTTP 500**, so the dashboard banner reads "The AgentPay API returned HTTP 500. Run npm run dev …".

## UI paths
- Whole app is one page (`src/main.tsx`): textarea + `START AGENT` button, LIVE TRACE panel, MARKETPLACE (3 cards), Payment Ledger table, result card. Error banner and `Retry connection` button appear directly under START AGENT.
- Expected demo run: 3 services (supplier-search $0.002, company-verification $0.001, esg $0.005), 3 "Demo receipt" ledger rows, spent $0.008 / remaining $0.042.

## Fault injection recipes (temporary edits to server/index.ts; back it up and restore)
- Malformed 402 amount: in `challenge()` replace `amount: prices[service].toFixed(3)` with `amount: 'not-a-number'` → run must abort with "… returned an unusable payment amount." and settle nothing (proves the NaN budget-guardrail check).
- Non-JSON upstream: register `app.get('/api/services/supplier-search', (_req,res) => res.status(402).type('html').send('<html>oops</html>'))` before the generated routes → error must read "returned a non-JSON response (HTTP 402)", never "Unexpected token <".
- Restart the API after each edit (`tsx` here has no watch mode).

## Useful checks without the UI
- `curl -s localhost:8787/api/ledger` gives receipt ids; `curl -H "x-payment-receipt: <id>" localhost:8787/api/services/esg` should return 200 with `demo_data: true`, and 402 without the header.
- Unknown paths: `curl -i localhost:8787/api/nope` → JSON `{"error":"Not Found"}`.

## Known UI gap
On an agent-run failure the client discards the partial `activities` the server returns, so the LIVE TRACE panel stays empty and only the banner shows the error (no `TASK FAILED` row is visible).

## Devin Secrets Needed
None for demo-mode testing.
