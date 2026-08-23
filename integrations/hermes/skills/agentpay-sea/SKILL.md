---
name: agentpay-sea
description: Buy AgentPay SEA's x402-protected synthetic business capabilities from Hermes Agent.
version: 0.1.0
metadata:
  hermes:
    tags: [payments, x402, agentpay]
    category: payments
    requires_toolsets: [terminal]
---

# AgentPay SEA

## When to Use

Use this skill when a task needs supplier search, company verification, or ESG data from AgentPay SEA. The API returns synthetic/demo business data unless the server is explicitly configured for real settlement.

## Procedure

1. Check the API before buying:

   ```bash
   agentpay --json status
   agentpay --json services
   ```

2. Inspect a payment challenge when needed:

   ```bash
   agentpay --json quote <service>
   ```

3. Buy only after applying the user's spending authorization:

   ```bash
   agentpay --json buy <service>
   ```

   For an explicitly approved purchase above the automatic threshold, use `--yes`:

   ```bash
   agentpay --json buy <service> --yes
   ```

4. For the deterministic multi-capability workflow, pass the user's prompt:

   ```bash
   agentpay --json run <prompt...>
   ```

5. Review prior spending when needed:

   ```bash
   agentpay --json ledger
   ```

Always use `--json` so the result is machine-readable, and always read the command exit code. Exit code `3` means a policy refusal: do not retry with `--yes` unless the user explicitly approves it. Exit code `1` indicates an API/runtime error and exit code `2` indicates invalid command usage.

## Pitfalls

- The AgentPay API server must be running (`npm run dev` or `npm start` in the project).
- Demo mode issues a local demo receipt and has no real on-chain transaction or signature.
- The budget is shared across CLI invocations because it is calculated from the server ledger, not local state.
- Never pass, request, or print `SERVER_PRIVATE_KEY`. Settlement remains server-side.
- Keep the returned supplier, company, and ESG information visibly labeled synthetic/demo data.

## Verification

Confirm `agentpay --json status` reports `reachable: true`, then use `agentpay --json buy <service>` and verify the JSON contains a receipt and unlocked data. Use `agentpay --json ledger` to confirm the payment and total spent.
