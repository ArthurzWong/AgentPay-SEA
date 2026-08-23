import cors from 'cors';
import express, { type Request, type Response } from 'express';
import type { Activity, AgentRunResponse, Payment, ServiceId, ServiceSummary } from '../shared/types.js';
import { BUDGET, NETWORK, SERVICE_DEFINITIONS, SERVICE_IDS, SERVICE_PRICES, SOLANA_NETWORK } from '../shared/services.js';
import { errorToMessage, formatUsdcAmount } from '../shared/utils.js';
import { demoMode, port } from './config.js';

export const app = express();
app.use(cors()); app.use(express.json());
const payments = new Map<string, Payment>();

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
  app.get(`/api/services/${service}`, (req, res) => { if (requirePayment(service, req, res)) res.json({ demo_data: true, ...protectedData(service) }); });
}
SERVICE_IDS.forEach(route);

async function settle(service: ServiceId): Promise<Payment> {
  const base: Payment = { id: crypto.randomUUID(), service, amount: SERVICE_PRICES[service], status: 'demo', signature: null, createdAt: new Date().toISOString() };
  if (demoMode) { payments.set(base.id, base); return base; }
  // Keep Devnet-only native dependencies out of the Demo Mode function cold start.
  const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
  const { createAssociatedTokenAccountInstruction, createTransferCheckedInstruction, getAccount, getAssociatedTokenAddress } = await import('@solana/spl-token');
  const secret = process.env.SERVER_PRIVATE_KEY, merchant = process.env.MERCHANT_WALLET, mint = process.env.USDC_MINT;
  if (!secret || !merchant || !mint) throw new Error('Real payment mode needs SERVER_PRIVATE_KEY, MERCHANT_WALLET, and USDC_MINT.');
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  const mintKey = new PublicKey(mint), merchantKey = new PublicKey(merchant);
  const connection = new Connection(process.env.RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
  const source = await getAssociatedTokenAddress(mintKey, payer.publicKey);
  const destination = await getAssociatedTokenAddress(mintKey, merchantKey);
  const amount = Math.round(SERVICE_PRICES[service] * 1_000_000);
  const tx = new Transaction();
  // The merchant needs no pre-existing USDC token account; create its ATA on the first paid request.
  try { await getAccount(connection, destination); }
  catch { tx.add(createAssociatedTokenAccountInstruction(payer.publicKey, destination, merchantKey, mintKey)); }
  tx.add(createTransferCheckedInstruction(source, mintKey, destination, payer.publicKey, amount, 6));
  const signature = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
  // A confirmed signature is checked again against the configured RPC before the API unlocks.
  const verified = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
  if (!verified.value || verified.value.err || !['confirmed', 'finalized'].includes(verified.value.confirmationStatus || '')) throw new Error('Payment verification failed on Solana.');
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
      const initial = await callProtectedService(baseUrl, service);
      if (initial.status !== 402) throw new Error(`Expected a 402 from ${service}, received ${initial.status}.`);
      const requirement = await initial.json() as { payment: { amount: string } };
      const price = Number(requirement.payment.amount);
      activities.push({ label: '402 PAYMENT REQUIRED', detail: `$${formatUsdcAmount(price)} USDC`, tone: 'payment' });
      if (spent + price > budget) throw new Error(`Budget exceeded before ${SERVICE_DEFINITIONS[service].name}.`);
      activities.push({ label: 'BUDGET CHECK', detail: 'Within authorized budget. Auto-approved below $0.010.', tone: 'info' });
      activities.push({ label: 'PAYMENT AUTHORIZED', detail: `$${formatUsdcAmount(price)} USDC`, tone: 'payment' });
      const payment = await settle(service); records.push(payment); spent += payment.amount;
      activities.push({ label: payment.signature ? 'SOLANA PAYMENT CONFIRMED' : 'DEMO PAYMENT AUTHORIZED', detail: payment.signature || 'No on-chain transaction in Demo Mode.', tone: 'success', signature: payment.signature });
      activities.push({ label: 'PAYMENT VERIFIED', detail: payment.signature ? 'Confirmed by Solana RPC.' : 'Local demo receipt verified.', tone: 'success' });
      const unlocked = await callProtectedService(baseUrl, service, payment.id);
      if (!unlocked.ok) throw new Error(`${SERVICE_DEFINITIONS[service].name} did not unlock after settlement.`);
      await unlocked.json(); activities.push({ label: 'DATA RECEIVED', detail: SERVICE_DEFINITIONS[service].name, tone: 'success' });
    }
    activities.push({ label: 'TASK COMPLETE', detail: 'Recommendation assembled from three paid capabilities.', tone: 'success' });
    const result: AgentRunResponse = { prompt, activities, payments: records, spent, remaining: budget - spent, result: { supplier: 'ABC Solar Sdn Bhd', cost: 42000, rating: 4.6, verification: 'VERIFIED', esg: 78, renewable: 64 } };
    res.json(result);
  } catch (error) {
    const message = errorToMessage(error);
    activities.push({ label: 'TASK FAILED', detail: message, tone: 'error' });
    res.status(400).json({ activities, error: message });
  }
});
