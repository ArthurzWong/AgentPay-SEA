# AgentPay SEA

AgentPay SEA is a hackathon MVP for autonomous AI commerce. An agent must receive an HTTP 402 payment challenge, settle a USDC payment on Solana Devnet, have that payment verified server-side, and then retry the protected API.

## Existing architecture

- `src/`: Vite + React TypeScript dashboard.
- `server/index.ts`: Express API, protected services, budget guardrail, payment settlement, and deterministic agent orchestration.
- `cli/agentpay.ts`: dependency-light terminal CLI for external agents, including Hermes Agent.
- `@solana/web3.js` + `@solana/spl-token`: Devnet SPL USDC `TransferChecked` settlement.
- Demo mode is the default. It exercises the exact 402/retry workflow but deliberately shows no fabricated Solana signature.

## Non-negotiables

- Never expose `SERVER_PRIVATE_KEY`, `LLM_API_KEY`, or RPC credentials in browser code.
- Keep all supplier, company, and ESG data visibly marked synthetic/demo data.
- Keep settlement server-side and only unlock an API after an issued verified receipt.
- Do not add a custom smart contract unless a payment requirement truly demands it.
- Prefer deterministic tools (`supplier-search`, `company-verification`, `esg`) over open-ended autonomous actions for demos.

## Local workflow

```bash
npm install
npm run dev
npm run check
npm run build
```

To enable real Devnet USDC settlement, copy `.env.example` to `.env`, set `DEMO_MODE=false`, and provide the funded server key, merchant public key, mint, and RPC URL. See `README.md` for the required variables.

## Recommended capabilities

- Skill: `scaffold-project` for project context; `frontend-design-guidelines` when extending the dashboard.
- MCP: `helius-mcp` (configured in `.claude/settings.json`) for Devnet transaction and account inspection. It requires `HELIUS_API_KEY` in the local environment.
