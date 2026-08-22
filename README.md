# AgentPay SEA

An MVP showing an AI agent purchasing three protected capabilities through an HTTP 402 payment gate.

## Run

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`.

The default `DEMO_MODE=true` is intentional: it exercises the identical request → 402 → authorization → receipt verification → retry path using deterministic synthetic supplier and ESG data, but does not claim an on-chain transfer occurred.

## Real Solana Devnet settlement

Set `DEMO_MODE=false` and configure the server-only variables in `.env`:

- `SERVER_PRIVATE_KEY`: a JSON array containing the funded payer keypair secret bytes.
- `MERCHANT_WALLET`: public key of the merchant that receives payment.
- `USDC_MINT`: mint used by both payer and merchant token accounts.
- `RPC_URL`: a Devnet RPC endpoint.

The server then creates an SPL Token `TransferChecked` transaction for every 402 challenge, confirms it on the configured RPC, re-checks the signature status, and only then creates the receipt accepted by a protected route. The UI links actual confirmed signatures to Solana Explorer; it deliberately says “Transaction unavailable” for demo receipts.

## API flow

`GET /api/services/:service` without `X-Payment-Receipt` responds `402` plus a base64 `X-Payment-Required` challenge. The agent reads the price, applies the $0.050 budget and $0.010 auto-approve policy, settles, then retries the same endpoint with its verified receipt.

The three protected services are `supplier-search` ($0.002), `company-verification` ($0.001), and `esg` ($0.005). All returned business data is visibly synthetic/demo data.
