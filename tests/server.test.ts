import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@solana/web3.js', () => ({
  Connection: class {},
  Keypair: {
    generate: () => ({
      secretKey: Uint8Array.from([1, 2, 3]),
      publicKey: { toBase58: () => '11111111111111111111111111111111' }
    })
  },
  PublicKey: class {},
  Transaction: class {},
  sendAndConfirmTransaction: () => undefined
}));
vi.mock('@solana/spl-token', () => ({
  createAssociatedTokenAccountInstruction: () => undefined,
  createTransferCheckedInstruction: () => undefined,
  getAccount: () => undefined,
  getAssociatedTokenAddress: () => undefined
}));

const envKeys = [
  'PORT',
  'DEMO_MODE',
  'VERCEL_URL',
  'SERVER_PRIVATE_KEY',
  'MERCHANT_WALLET',
  'USDC_MINT',
  'RPC_URL'
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const walletScript = resolve('scripts/create-devnet-wallet.mjs');

type ServerModule = typeof import('../server/index.ts');

function clearTestEnvironment() {
  for (const key of envKeys) delete process.env[key];
}

async function importServer(options: { demoMode?: boolean; port?: number } = {}): Promise<ServerModule> {
  vi.resetModules();
  clearTestEnvironment();
  if (options.demoMode !== undefined) process.env.DEMO_MODE = String(options.demoMode);
  if (options.port !== undefined) process.env.PORT = String(options.port);
  return import('../server/index.ts');
}

async function findFreePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine an ephemeral port.');
  const port = address.port;
  await new Promise<void>((resolveClose, rejectClose) => probe.close((error) => error ? rejectClose(error) : resolveClose()));
  return port;
}

async function startServer(options: { demoMode?: boolean } = {}) {
  const port = await findFreePort();
  const module = await importServer({ ...options, port });
  const server = module.app.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return { ...module, server };
}

async function closeServer(server: Server) {
  if (server.listening) {
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
}

afterEach(() => {
  clearTestEnvironment();
});

afterAll(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('server API', () => {
  it('returns the dashboard configuration and all service prices', async () => {
    const { app } = await importServer();

    const response = await request(app).get('/api/config').expect(200);

    expect(response.body).toEqual({
      demoMode: true,
      network: 'devnet',
      budget: 0.05,
      services: [
        {
          id: 'supplier-search',
          name: 'Supplier Intelligence',
          description: 'Synthetic Malaysian solar supplier shortlist.',
          price: 0.002
        },
        {
          id: 'company-verification',
          name: 'Company Verification',
          description: 'Synthetic company registration verification.',
          price: 0.001
        },
        {
          id: 'esg',
          name: 'ESG Intelligence',
          description: 'Synthetic ESG profile for supplier evaluation.',
          price: 0.005
        }
      ]
    });
  });

  it('starts with an empty ledger in a fresh module instance', async () => {
    const { app } = await importServer();

    await request(app).get('/api/ledger').expect(200).expect([]);
  });

  it('returns ledger payments in descending created-at order', async () => {
    const { app, server } = await startServer();
    try {
      const run = await request(app).post('/api/agent/run').send({ prompt: 'ledger ordering' }).expect(200);
      const ledger = await request(app).get('/api/ledger').expect(200);

      expect(ledger.body).toHaveLength(3);
      expect(ledger.body.map((payment: { id: string }) => payment.id)).toEqual(
        [...run.body.payments]
          .sort((a: { createdAt: string }, b: { createdAt: string }) => b.createdAt.localeCompare(a.createdAt))
          .map((payment: { id: string }) => payment.id)
      );
      for (let index = 1; index < ledger.body.length; index += 1) {
        expect(ledger.body[index - 1].createdAt >= ledger.body[index].createdAt).toBe(true);
      }
    } finally {
      await closeServer(server);
    }
  });

  it.each([
    ['supplier-search', '0.002'],
    ['company-verification', '0.001'],
    ['esg', '0.005']
  ] as const)('challenges %s with a matching encoded payment requirement', async (service, amount) => {
    const { app } = await importServer();

    const response = await request(app).get(`/api/services/${service}`).expect(402);
    const requirement = {
      scheme: 'exact',
      network: 'solana-devnet',
      asset: 'USDC',
      amount,
      service,
      description: response.body.payment.description
    };

    expect(response.body).toEqual({ error: 'Payment Required', payment: requirement });
    expect(JSON.parse(Buffer.from(response.headers['x-payment-required'], 'base64').toString('utf8'))).toEqual(requirement);
  });

  it('rejects missing and unknown receipts', async () => {
    const { app } = await importServer();

    await request(app).get('/api/services/supplier-search').expect(402);
    await request(app)
      .get('/api/services/company-verification')
      .set('x-payment-receipt', 'not-a-issued-receipt')
      .expect(402);
  });

  it('does not allow a valid receipt to unlock a different service', async () => {
    const { app, server } = await startServer();
    try {
      const run = await request(app).post('/api/agent/run').send({ prompt: 'receipt scope' }).expect(200);
      const supplierReceipt = run.body.payments.find((payment: { service: string }) => payment.service === 'supplier-search').id;

      await request(app)
        .get('/api/services/company-verification')
        .set('x-payment-receipt', supplierReceipt)
        .expect(402);
    } finally {
      await closeServer(server);
    }
  });

  it('unlocks each service with its issued demo receipt and marks data synthetic', async () => {
    const { app, server } = await startServer();
    try {
      const run = await request(app).post('/api/agent/run').send({ prompt: 'unlock services' }).expect(200);
      const expectedKeys = {
        'supplier-search': ['demo_data', 'suppliers'],
        'company-verification': ['business_status', 'company', 'country', 'demo_data', 'registration_status'],
        esg: ['carbon_intensity', 'company', 'demo_data', 'esg_score', 'estimated_emissions', 'renewable_percentage']
      };

      for (const payment of run.body.payments as Array<{ id: string; service: keyof typeof expectedKeys }>) {
        const response = await request(app)
          .get(`/api/services/${payment.service}`)
          .set('x-payment-receipt', payment.id)
          .expect(200);
        expect(response.body.demo_data).toBe(true);
        expect(Object.keys(response.body).sort()).toEqual([...expectedKeys[payment.service]].sort());
      }
    } finally {
      await closeServer(server);
    }
  });

  it('runs the default demo workflow and reports all authorized payments', async () => {
    const { app, server } = await startServer();
    try {
      const response = await request(app).post('/api/agent/run').send({}).expect(200);
      const labels = response.body.activities.map((activity: { label: string }) => activity.label);

      expect(response.body.prompt).toBe('Find the best Malaysian solar supplier under RM50,000 and evaluate its ESG profile.');
      expect(labels).toEqual([
        'TASK RECEIVED',
        'PLANNING',
        'CALLING SUPPLIER INTELLIGENCE',
        '402 PAYMENT REQUIRED',
        'BUDGET CHECK',
        'PAYMENT AUTHORIZED',
        'DEMO PAYMENT AUTHORIZED',
        'PAYMENT VERIFIED',
        'DATA RECEIVED',
        'CALLING COMPANY VERIFICATION',
        '402 PAYMENT REQUIRED',
        'BUDGET CHECK',
        'PAYMENT AUTHORIZED',
        'DEMO PAYMENT AUTHORIZED',
        'PAYMENT VERIFIED',
        'DATA RECEIVED',
        'CALLING ESG INTELLIGENCE',
        '402 PAYMENT REQUIRED',
        'BUDGET CHECK',
        'PAYMENT AUTHORIZED',
        'DEMO PAYMENT AUTHORIZED',
        'PAYMENT VERIFIED',
        'DATA RECEIVED',
        'TASK COMPLETE'
      ]);
      expect(response.body.payments).toHaveLength(3);
      expect(response.body.payments.every((payment: { signature: string | null }) => payment.signature === null)).toBe(true);
      expect(response.body.spent).toBe(0.008);
      expect(response.body.remaining).toBeCloseTo(0.042, 10);
      expect(response.body.result).toEqual({
        supplier: 'ABC Solar Sdn Bhd',
        cost: 42000,
        rating: 4.6,
        verification: 'VERIFIED',
        esg: 78,
        renewable: 64
      });
    } finally {
      await closeServer(server);
    }
  });

  it('reports real-mode configuration failures as a failed task without Solana calls', async () => {
    const { app, server } = await startServer({ demoMode: false });
    try {
      const response = await request(app).post('/api/agent/run').send({ prompt: 'real mode guard' }).expect(400);
      const failed = response.body.activities.find((activity: { label: string }) => activity.label === 'TASK FAILED');

      expect(failed.detail).toBe('Real payment mode needs SERVER_PRIVATE_KEY, MERCHANT_WALLET, and USDC_MINT.');
    } finally {
      await closeServer(server);
    }
  });
});

describe('Vercel API handler', () => {
  it('delegates requests to the Express application', async () => {
    vi.resetModules();
    const { default: handler } = await import('../api/[...path].ts');

    const response = await request(handler as unknown as import('node:http').RequestListener).get('/api/config').expect(200);
    expect(response.body).toEqual(expect.objectContaining({ demoMode: true, network: 'devnet' }));
  });
});

describe('devnet wallet generator', () => {
  it('writes a private .env with the expected wallet configuration', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agentpay-wallet-'));
    try {
      const result = spawnSync(process.execPath, ['--experimental-require-module', walletScript], { cwd, encoding: 'utf8' });
      const envPath = join(cwd, '.env');
      const content = readFileSync(envPath, 'utf8');

      expect(result.status).toBe(0);
      expect(content).toContain('DEMO_MODE=true');
      expect(content).toContain('PORT=8787');
      expect(content).toContain('RPC_URL=https://api.devnet.solana.com');
      expect(content).toMatch(/SERVER_PRIVATE_KEY=\[[0-9,]+\]/);
      expect(content).toMatch(/MERCHANT_WALLET=[1-9A-HJ-NP-Za-km-z]{32,44}/);
      expect(content).toContain('USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
      expect(content).toContain('LLM_API_KEY=');
      expect(statSync(envPath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite an existing private key', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agentpay-wallet-'));
    try {
      writeFileSync(join(cwd, '.env'), 'SERVER_PRIVATE_KEY=already-present\n');
      const result = spawnSync(process.execPath, ['--experimental-require-module', walletScript], { cwd, encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('.env already has a SERVER_PRIVATE_KEY. Refusing to overwrite it.');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('can execute in an isolated directory for coverage instrumentation', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agentpay-wallet-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(cwd);
      await import('../scripts/create-devnet-wallet.mjs');
      expect(readFileSync(join(cwd, '.env'), 'utf8')).toContain('SERVER_PRIVATE_KEY=');
    } finally {
      process.chdir(previousCwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
