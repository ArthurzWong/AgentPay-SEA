# Hermes Agent integration

Install the skill by copying its directory into Hermes' payments skills:

```bash
mkdir -p ~/.hermes/skills/payments
cp -R integrations/hermes/skills/agentpay-sea ~/.hermes/skills/payments/agentpay-sea/
```

Install/link the CLI from the AgentPay SEA repository, then configure the API:

```bash
npm link
export AGENTPAY_API_URL=http://localhost:8787
agentpay status --json
```

The skill requires Hermes' `terminal` toolset. Keep `SERVER_PRIVATE_KEY` on the API server only; never put it in Hermes or client environment shared with the agent.
