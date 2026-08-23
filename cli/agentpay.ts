#!/usr/bin/env node
type Payment = {
  id: string;
  service: string;
  amount: number;
  status: string;
  signature: string | null;
  createdAt: string;
};
type Config = {
  demoMode: boolean;
  network: string;
  budget: number;
  services: Array<{ id: string; name: string; price: number; description: string }>;
};
type Challenge = {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  service: string;
  description: string;
};
type ParsedArgs = {
  command: string;
  args: string[];
  baseUrl: string;
  json: boolean;
  help: boolean;
  yes: boolean;
  maxPrice: number;
  budget: number;
};

const DEFAULT_BASE_URL = 'http://localhost:8787';
const DEFAULT_MAX_PRICE = 0.010;
const DEFAULT_BUDGET = 0.05;
const usage = `Usage: agentpay [--base-url <url>] [--json] <command>

Commands:
  services                 List protected services and prices
  quote <service>          Show the 402 payment challenge
  buy <service>            Pay for and unlock a protected service
  run [prompt...]          Run the deterministic agent workflow
  ledger                   Show issued payments and total spent
  status                   Check API reachability, mode, and spending
  help                     Show this help

Buy policy flags:
  --max-price <usd>        Auto-approve threshold (default: 0.010)
  --budget <usd>           Shared spending limit (default: 0.05)
  --yes                    Approve purchases above --max-price

Global flags:
  --base-url <url>         API URL (env: AGENTPAY_API_URL)
  --json                   Emit one machine-readable JSON object

Exit codes: 0 success, 1 runtime/API error, 2 usage error, 3 policy refusal.`;

class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
  }
}

function numberOption(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new CliError(`${name} must be a non-negative number.`, 2);
  return parsed;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let baseUrl = process.env.AGENTPAY_API_URL || DEFAULT_BASE_URL;
  let json = false, help = false, yes = false;
  let maxPrice = DEFAULT_MAX_PRICE, budget = DEFAULT_BUDGET;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') { json = true; continue; }
    if (arg === '--help' || arg === '-h') { help = true; continue; }
    if (arg === '--yes') { yes = true; continue; }
    if (arg === '--base-url' || arg === '--max-price' || arg === '--budget') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new CliError(`${arg} requires a value.`, 2);
      if (arg === '--base-url') baseUrl = value;
      if (arg === '--max-price') maxPrice = numberOption('--max-price', value);
      if (arg === '--budget') budget = numberOption('--budget', value);
      continue;
    }
    if (arg.startsWith('-')) throw new CliError(`Unknown option: ${arg}`, 2);
    positional.push(arg);
  }
  if (!baseUrl) throw new CliError('--base-url must not be empty.', 2);
  return { command: positional[0] || 'help', args: positional.slice(1), baseUrl: baseUrl.replace(/\/+$/, ''), json, help, yes, maxPrice, budget };
}

function output(value: unknown, json: boolean): void {
  if (json) console.log(JSON.stringify(value));
  else if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

async function request(baseUrl: string, path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${baseUrl}${path}`, init);
  } catch (error) {
    throw new CliError(`API unreachable at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function body(response: Response): Promise<any> {
  try { return await response.json(); }
  catch { return null; }
}

async function requireOk(response: Response, context: string): Promise<any> {
  if (!response.ok) {
    const data = await body(response);
    const detail = data?.error || data?.message || response.statusText || `HTTP ${response.status}`;
    throw new CliError(`${context}: ${detail}`);
  }
  return body(response);
}

function decodeChallenge(response: Response): Challenge {
  const encoded = response.headers.get('x-payment-required');
  if (!encoded) throw new CliError('402 response did not include X-Payment-Required.');
  try {
    const challenge = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Challenge;
    if (!challenge.service || !challenge.amount) throw new Error('missing service or amount');
    return challenge;
  } catch (error) {
    throw new CliError(`Could not decode X-Payment-Required: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function paymentsFrom(data: unknown): Payment[] {
  if (Array.isArray(data)) return data as Payment[];
  if (data && typeof data === 'object' && Array.isArray((data as { payments?: unknown }).payments)) return (data as { payments: Payment[] }).payments;
  throw new CliError('API returned an invalid ledger.');
}

async function ledger(baseUrl: string): Promise<Payment[]> {
  return paymentsFrom(await requireOk(await request(baseUrl, '/api/ledger'), 'Could not read ledger'));
}

function totalSpent(payments: Payment[]): number {
  return payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
}

async function services(args: ParsedArgs): Promise<unknown> {
  const config = await requireOk(await request(args.baseUrl, '/api/config'), 'Could not read service configuration') as Config;
  if (args.json) return { demoMode: config.demoMode, mode: config.demoMode ? 'demo' : 'real', services: config.services };
  console.log(`Mode: ${config.demoMode ? 'demo' : 'real settlement'}`);
  for (const service of config.services) console.log(`${service.id}  $${service.price.toFixed(3)}  ${service.name} — ${service.description}`);
  return undefined;
}

async function quote(args: ParsedArgs): Promise<unknown> {
  if (args.args.length !== 1) throw new CliError('Usage: agentpay quote <service>', 2);
  const service = args.args[0];
  const response = await request(args.baseUrl, `/api/services/${encodeURIComponent(service)}`);
  if (response.status !== 402) throw new CliError(`Expected HTTP 402 for ${service}, received HTTP ${response.status}.`);
  const challenge = decodeChallenge(response);
  if (args.json) return { service, status: 402, challenge };
  output(challenge, false);
  return undefined;
}

async function buy(args: ParsedArgs): Promise<unknown> {
  if (args.args.length !== 1) throw new CliError('Usage: agentpay buy <service>', 2);
  const service = args.args[0];
  const initial = await request(args.baseUrl, `/api/services/${encodeURIComponent(service)}`);
  if (initial.status !== 402) throw new CliError(`Expected HTTP 402 for ${service}, received HTTP ${initial.status}.`);
  const challenge = decodeChallenge(initial);
  const price = Number(challenge.amount);
  if (!Number.isFinite(price) || price < 0) throw new CliError(`Invalid payment amount in challenge: ${challenge.amount}`);
  const spent = totalSpent(await ledger(args.baseUrl));
  if (!args.yes && price > args.maxPrice) {
    throw new CliError(`Policy refusal: ${service} costs $${price.toFixed(3)}, above --max-price $${args.maxPrice.toFixed(3)}. Pass --yes only with user approval.`, 3);
  }
  if (spent + price > args.budget) {
    throw new CliError(`Policy refusal: spending $${(spent + price).toFixed(3)} would exceed --budget $${args.budget.toFixed(3)} (already spent $${spent.toFixed(3)}).`, 3);
  }
  const payment = await requireOk(await request(args.baseUrl, '/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ service })
  }), 'Settlement failed') as Payment;
  const unlocked = await requireOk(await request(args.baseUrl, `/api/services/${encodeURIComponent(service)}`, {
    headers: { 'x-payment-receipt': payment.id }
  }), 'Could not unlock service');
  const result = {
    service,
    challenge,
    receipt: payment,
    onChainTransaction: payment.signature || 'no on-chain transaction in demo mode',
    data: unlocked,
    spent: spent + payment.amount,
    budget: args.budget
  };
  if (args.json) return result;
  console.log(`Receipt: ${payment.id}`);
  console.log(`Amount: $${payment.amount.toFixed(3)} USDC`);
  console.log(`Status: ${payment.status}`);
  console.log(payment.signature ? `Signature: ${payment.signature}` : 'No on-chain transaction in demo mode.');
  console.log('Unlocked data:');
  output(unlocked, false);
  return undefined;
}

async function run(args: ParsedArgs): Promise<unknown> {
  if (args.yes || args.maxPrice !== DEFAULT_MAX_PRICE || args.budget !== DEFAULT_BUDGET) throw new CliError('Buy policy flags are only valid with buy.', 2);
  const prompt = args.args.join(' ');
  const response = await request(args.baseUrl, '/api/agent/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(prompt ? { prompt } : {})
  });
  const result = await requireOk(response, 'Agent run failed');
  if (args.json) return result;
  for (const activity of result.activities || []) console.log(`${activity.label}${activity.detail ? ` — ${activity.detail}` : ''}`);
  console.log(`Spend: $${Number(result.spent).toFixed(3)} USDC`);
  console.log('Result:');
  output(result.result, false);
  return undefined;
}

async function ledgerCommand(args: ParsedArgs): Promise<unknown> {
  const payments = await ledger(args.baseUrl);
  const result = { payments, totalSpent: totalSpent(payments) };
  if (args.json) return result;
  output(payments, false);
  console.log(`Total spent: $${result.totalSpent.toFixed(3)} USDC`);
  return undefined;
}

async function status(args: ParsedArgs): Promise<unknown> {
  const config = await requireOk(await request(args.baseUrl, '/api/config'), 'API status failed') as Config;
  const payments = await ledger(args.baseUrl);
  const result = { reachable: true, mode: config.demoMode ? 'demo' : 'real', totalSpent: totalSpent(payments), baseUrl: args.baseUrl };
  if (args.json) return result;
  console.log(`API: reachable (${args.baseUrl})`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Total spent: $${result.totalSpent.toFixed(3)} USDC`);
  return undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.command === 'help') {
    if (args.json) output({ usage }, true);
    else console.log(usage);
    return;
  }
  if (args.command !== 'buy' && (args.yes || args.maxPrice !== DEFAULT_MAX_PRICE || args.budget !== DEFAULT_BUDGET)) {
    throw new CliError('Buy policy flags are only valid with buy.', 2);
  }
  let result: unknown;
  if (args.command === 'services') result = await services(args);
  else if (args.command === 'quote') result = await quote(args);
  else if (args.command === 'buy') result = await buy(args);
  else if (args.command === 'run') result = await run(args);
  else if (args.command === 'ledger') result = await ledgerCommand(args);
  else if (args.command === 'status') result = await status(args);
  else throw new CliError(`Unknown command: ${args.command}`, 2);
  if (args.json && result !== undefined) output(result, true);
}

const jsonMode = process.argv.includes('--json');
main().catch((error) => {
  const exitCode = error instanceof CliError ? error.exitCode : 1;
  const message = error instanceof Error ? error.message : String(error);
  if (jsonMode) console.log(JSON.stringify({ error: message, exitCode }));
  else console.error(`Error: ${message}`);
  process.exitCode = exitCode;
});
