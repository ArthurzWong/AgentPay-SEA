import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Activity, AgentRunResponse, Payment, ServiceId, ServiceSummary } from '../shared/types.js';
import { BUDGET, NETWORK, SERVICE_DEFINITIONS, SERVICE_IDS, SERVICE_PRICES, SOLANA_NETWORK } from '../shared/services.js';
import { errorToMessage, formatUsdcAmount } from '../shared/utils.js';
import { demoMode, port } from './config.js';

export const app = express();
app.use(cors()); app.use(express.json());
const payments = new Map<string, Payment>();

// Errors surfaced to a client keep their own status; anything else is an unexpected server fault.
class HttpError extends Error {
  constructor(readonly status: number, message: string, options?: { cause?: unknown }) { super(message, options); this.name = 'HttpError'; }
}
function statusOf(error: unknown) { return error instanceof HttpError ? error.status : 500; }
// Error bodies from the protected endpoints must never be parsed blindly: a proxy or crash can answer with HTML.
async function readJson(response: globalThis.Response, context: string): Promise<unknown> {
  const body = await response.text();
  try { return JSON.parse(body); }
  catch (error) { throw new HttpError(502, `${context} returned a non-JSON response (HTTP ${response.status}).`, { cause: error }); }
}

function challenge(service: ServiceId) {
  return { scheme: 'exact', network: SOLANA_NETWORK, asset: 'USDC', amount: formatUsdcAmount(SERVICE_PRICES[service]), service, description: SERVICE_DEFINITIONS[service].description };
}
function protectedData(service: ServiceId) {
  if (service === 'supplier-search') return { suppliers: [
    { name: 'ABC Solar Sdn Bhd', location: 'Selangor, Malaysia', estimated_project_cost: 42000, rating: 4.6 },
    { name: 'Green Energy Solutions', location: 'Kuala Lumpur, Malaysia', estimated_project_cost: 47000, rating: 4.4 }
  ] };
  if (service === 'company-verification') return { company: 'ABC Solar Sdn Bhd', registration_status: 'verified', country: 'Malaysia', business_status: 'active' };
  return { company: 'ABC Solar Sdn Bhd', esg_score: 78, renewable_percentage: 64, estimated_emissions: 1240, carbon_intensity: 0.42 };
}
function requirePayment(service: ServiceId, req: Request, res: Response): boolean {
  const receipt = req.header('x-payment-receipt');
  const payment = receipt ? payments.get(receipt) : undefined;
  if (!payment || payment.service !== service || !['confirmed', 'demo'].includes(payment.status)) {
    const requirement = challenge(service);
    res.status(402).set('X-Payment-Required', Buffer.from(JSON.stringify(requirement)).toString('base64')).json({ error: 'Payment Required', payment: requirement });
    return false;
  }
  return true;
}
function route(service: ServiceId) {
  app.get(`/api/services/${service}`, (req, res, next) => {
    try { if (requirePayment(service, req, res)) res.json({ demo_data: true, ...protectedData(service) }); }
    catch (error) { next(error); }
  });
}
SERVICE_IDS.forEach(route);

async function settle(service: ServiceId): Promise<Payment> {
  const base: Payment = { id: crypto.randomUUID(), service, amount: SERVICE_PRICES[service], status: 'demo', signature: null, createdAt: new Date().toISOString() };
  if (demoMode) { payments.set(base.id, base); return base; }
  // Keep Devnet-only native dependencies out of the Demo Mode function cold start.
  const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
  const { createAssociatedTokenAccountInstruction, createTransferCheckedInstruction, getAccount, getAssociatedTokenAddress, TokenAccountNotFoundError, TokenInvalidAccountOwnerError } = await import('@solana/spl-token');
  const secret = process.env.SERVER_PRIVATE_KEY, merchant = process.env.MERCHANT_WALLET, mint = process.env.USDC_MINT;
  if (!secret || !merchant || !mint) throw new HttpError(500, 'Real payment mode needs SERVER_PRIVATE_KEY, MERCHANT_WALLET, and USDC_MINT.');
  let payer: import('@solana/web3.js').Keypair, mintKey: import('@solana/web3.js').PublicKey, merchantKey: import('@solana/web3.js').PublicKey;
  try { payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret))); }
  catch (error) { throw new HttpError(500, 'SERVER_PRIVATE_KEY must be a JSON array of the 64 secret key bytes.', { cause: error }); }
  try { mintKey = new PublicKey(mint); merchantKey = new PublicKey(merchant); }
  catch (error) { throw new HttpError(500, 'USDC_MINT and MERCHANT_WALLET must be base58 Solana addresses.', { cause: error }); }
  const connection = new Connection(process.env.RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
  const source = await getAssociatedTokenAddress(mintKey, payer.publicKey);
  const destination = await getAssociatedTokenAddress(mintKey, merchantKey);
  const amount = Math.round(SERVICE_PRICES[service] * 1_000_000);
  const tx = new Transaction();
  // The merchant needs no pre-existing USDC token account; create its ATA on the first paid request.
  // Only a missing or foreign-owned account may be recreated: RPC failures must surface instead of silently
  // turning into an ATA creation that then fails with an unrelated on-chain error.
  try { await getAccount(connection, destination); }
  catch (error) {
    if (!(error instanceof TokenAccountNotFoundError || error instanceof TokenInvalidAccountOwnerError)) {
      throw new HttpError(502, `Could not read the merchant USDC account: ${errorToMessage(error)}`, { cause: error });
    }
    tx.add(createAssociatedTokenAccountInstruction(payer.publicKey, destination, merchantKey, mintKey));
  }
  tx.add(createTransferCheckedInstruction(source, mintKey, destination, payer.publicKey, amount, 6));
  let signature: string;
  try { signature = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' }); }
  catch (error) { throw new HttpError(502, `Solana settlement failed for ${SERVICE_DEFINITIONS[service].name}: ${errorToMessage(error)}`, { cause: error }); }
  // A confirmed signature is checked again against the configured RPC before the API unlocks.
  let verified: Awaited<ReturnType<typeof connection.getSignatureStatus>>;
  try { verified = await connection.getSignatureStatus(signature, { searchTransactionHistory: true }); }
  catch (error) { throw new HttpError(502, `Could not verify signature ${signature} with the Solana RPC: ${errorToMessage(error)}`, { cause: error }); }
  if (!verified.value || verified.value.err || !['confirmed', 'finalized'].includes(verified.value.confirmationStatus || '')) {
    throw new HttpError(502, `Payment verification failed on Solana for signature ${signature}.`);
  }
  const payment: Payment = { ...base, status: 'confirmed', signature };
  payments.set(payment.id, payment); return payment;
}

app.get('/api/config', (_req, res) => res.json({ demoMode, network: NETWORK, budget: BUDGET, services: Object.entries(SERVICE_DEFINITIONS).map(([id, value]) => ({ id: id as ServiceId, ...value, price: SERVICE_PRICES[id as ServiceId] } satisfies ServiceSummary)) }));
app.get('/api/ledger', (_req, res) => res.json([...payments.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))));

async function callProtectedService(baseUrl: string, service: ServiceId, receipt?: string) {
  return fetch(`${baseUrl}/api/services/${service}`, receipt ? { headers: { 'x-payment-receipt': receipt } } : undefined);
}

app.post('/api/agent/run', async (req, res) => {
  const prompt = String(req.body?.prompt || 'Find the best Malaysian solar supplier under RM50,000 and evaluate its ESG profile.');
  const activities: Activity[] = [
    { label: 'TASK RECEIVED', detail: prompt, tone: 'info' },
    { label: 'PLANNING', detail: 'I need supplier information, verification, and an ESG profile.', tone: 'info' }
  ];
  const budget = BUDGET; let spent = 0;
  const records: Payment[] = [];
  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://127.0.0.1:${port}`;
  try {
    for (const service of SERVICE_IDS) {
      activities.push({ label: `CALLING ${SERVICE_DEFINITIONS[service].name.toUpperCase()}`, tone: 'info' });
      // This deliberately goes through the protected HTTP endpoint first: the 402 is the payment trigger.
      let initial: globalThis.Response;
      try { initial = await callProtectedService(baseUrl, service); }
      catch (error) { throw new HttpError(502, `Could not reach ${SERVICE_DEFINITIONS[service].name} at ${baseUrl}: ${errorToMessage(error)}`, { cause: error }); }
      if (initial.status !== 402) throw new HttpError(502, `Expected a 402 from ${service}, received ${initial.status}.`);
      const requirement = await readJson(initial, SERVICE_DEFINITIONS[service].name) as { payment?: { amount?: unknown } };
      const price = Number(requirement.payment?.amount);
      // A malformed challenge would make every budget comparison NaN-false and skip the guardrail entirely.
      if (!Number.isFinite(price) || price <= 0) throw new HttpError(502, `${SERVICE_DEFINITIONS[service].name} returned an unusable payment amount.`);
      activities.push({ label: '402 PAYMENT REQUIRED', detail: `$${formatUsdcAmount(price)} USDC`, tone: 'payment' });
      if (spent + price > budget) throw new HttpError(402, `Budget exceeded before ${SERVICE_DEFINITIONS[service].name}.`);
      activities.push({ label: 'BUDGET CHECK', detail: 'Within authorized budget. Auto-approved below $0.010.', tone: 'info' });
      activities.push({ label: 'PAYMENT AUTHORIZED', detail: `$${formatUsdcAmount(price)} USDC`, tone: 'payment' });
      const payment = await settle(service); records.push(payment); spent += payment.amount;
      activities.push({ label: payment.signature ? 'SOLANA PAYMENT CONFIRMED' : 'DEMO PAYMENT AUTHORIZED', detail: payment.signature || 'No on-chain transaction in Demo Mode.', tone: 'success', signature: payment.signature });
      activities.push({ label: 'PAYMENT VERIFIED', detail: payment.signature ? 'Confirmed by Solana RPC.' : 'Local demo receipt verified.', tone: 'success' });
      let unlocked: globalThis.Response;
      try { unlocked = await callProtectedService(baseUrl, service, payment.id); }
      catch (error) { throw new HttpError(502, `Could not retry ${SERVICE_DEFINITIONS[service].name} after settlement: ${errorToMessage(error)}`, { cause: error }); }
      if (!unlocked.ok) throw new HttpError(502, `${SERVICE_DEFINITIONS[service].name} did not unlock after settlement (HTTP ${unlocked.status}).`);
      await readJson(unlocked, SERVICE_DEFINITIONS[service].name);
      activities.push({ label: 'DATA RECEIVED', detail: SERVICE_DEFINITIONS[service].name, tone: 'success' });
    }
    activities.push({ label: 'TASK COMPLETE', detail: 'Recommendation assembled from three paid capabilities.', tone: 'success' });
    const result: AgentRunResponse = { prompt, activities, payments: records, spent, remaining: budget - spent, result: { supplier: 'ABC Solar Sdn Bhd', cost: 42000, rating: 4.6, verification: 'VERIFIED', esg: 78, renewable: 64 } };
    res.json(result);
  } catch (error) {
    const status = statusOf(error), detail = errorToMessage(error);
    console.error(`[agent/run] failed after $${formatUsdcAmount(spent)} spent:`, error);
    activities.push({ label: 'TASK FAILED', detail, tone: 'error' });
    res.status(status).json({ activities, payments: records, spent, error: detail });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not Found' }));
// Express would otherwise answer an unhandled route error with an HTML stack trace the dashboard cannot parse.
app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  console.error('[api] unhandled error:', error);
  if (res.headersSent) return next(error);
  res.status(statusOf(error)).json({ error: error instanceof HttpError ? error.message : 'Internal Server Error' });
});
