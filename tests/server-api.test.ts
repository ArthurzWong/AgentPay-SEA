import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  clearTestEnvironment,
  closeServer,
  importServer,
  resetSolanaMocks,
  restoreTestEnvironment,
  solanaMockState,
  startServer
} from './helpers';

afterEach(() => {
  clearTestEnvironment();
  resetSolanaMocks();
});

afterAll(restoreTestEnvironment);

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
    ['supplier-search', '0.002', 'Synthetic Malaysian solar supplier shortlist.'],
    ['company-verification', '0.001', 'Synthetic company registration verification.'],
    ['esg', '0.005', 'Synthetic ESG profile for supplier evaluation.']
  ] as const)('challenges %s with a matching encoded payment requirement', async (service, amount, description) => {
    const { app } = await importServer();
    const response = await request(app).get(`/api/services/${service}`).expect(402);
    const requirement = { scheme: 'exact', network: 'solana-devnet', asset: 'USDC', amount, service, description };

    expect(response.body).toEqual({ error: 'Payment Required', payment: requirement });
    expect(JSON.parse(Buffer.from(response.headers['x-payment-required'], 'base64').toString('utf8'))).toEqual(requirement);
  });

  it('rejects missing and unknown receipts', async () => {
    const { app } = await importServer();
    await request(app).get('/api/services/supplier-search').expect(402);
    await request(app).get('/api/services/company-verification').set('x-payment-receipt', 'not-a-issued-receipt').expect(402);
  });

  it('does not allow a valid receipt to unlock a different service', async () => {
    const { app, server } = await startServer();
    try {
      const run = await request(app).post('/api/agent/run').send({ prompt: 'receipt scope' }).expect(200);
      const supplierReceipt = run.body.payments.find((payment: { service: string }) => payment.service === 'supplier-search').id;
      await request(app).get('/api/services/company-verification').set('x-payment-receipt', supplierReceipt).expect(402);
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
        const response = await request(app).get(`/api/services/${payment.service}`).set('x-payment-receipt', payment.id).expect(200);
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
        'TASK RECEIVED', 'PLANNING', 'CALLING SUPPLIER INTELLIGENCE', '402 PAYMENT REQUIRED', 'BUDGET CHECK',
        'PAYMENT AUTHORIZED', 'DEMO PAYMENT AUTHORIZED', 'PAYMENT VERIFIED', 'DATA RECEIVED',
        'CALLING COMPANY VERIFICATION', '402 PAYMENT REQUIRED', 'BUDGET CHECK', 'PAYMENT AUTHORIZED',
        'DEMO PAYMENT AUTHORIZED', 'PAYMENT VERIFIED', 'DATA RECEIVED', 'CALLING ESG INTELLIGENCE',
        '402 PAYMENT REQUIRED', 'BUDGET CHECK', 'PAYMENT AUTHORIZED', 'DEMO PAYMENT AUTHORIZED',
        'PAYMENT VERIFIED', 'DATA RECEIVED', 'TASK COMPLETE'
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

describe('real settlement', () => {
  it('confirms a payment, records its signature, and unlocks the service', async () => {
    const { app, server } = await startServer({ demoMode: false, realCredentials: true });
    try {
      const response = await request(app).post('/api/agent/run').send({ prompt: 'real settlement' }).expect(200);
      const firstPayment = response.body.payments[0];

      expect(firstPayment.status).toBe('confirmed');
      expect(firstPayment.signature).toBe('mock-signature');
      expect(response.body.activities.some((activity: { label: string }) => activity.label === 'SOLANA PAYMENT CONFIRMED')).toBe(true);
      expect(solanaMockState.sendCalls).toHaveLength(3);
      expect(solanaMockState.transferCalls[0]).toEqual([
        'source-token-account',
        solanaMockState.mintPublicKey,
        'destination-token-account',
        solanaMockState.payerPublicKey,
        2000,
        6
      ]);
      expect(solanaMockState.connectionArgs).toEqual(['https://api.devnet.solana.com', 'confirmed']);
      expect(solanaMockState.signatureStatusCalls[0]).toEqual(['mock-signature', { searchTransactionHistory: true }]);
      expect(solanaMockState.transactions[0].instructions).toEqual(expect.arrayContaining([
        {
          type: 'transfer-checked',
          args: [
            'source-token-account',
            solanaMockState.mintPublicKey,
            'destination-token-account',
            solanaMockState.payerPublicKey,
            2000,
            6
          ]
        }
      ]));
      expect(solanaMockState.sendCalls[0][1]).toBe(solanaMockState.transactions[0]);
      expect(solanaMockState.sendCalls[0][2]).toEqual([{ publicKey: solanaMockState.payerPublicKey, secretKey: Uint8Array.from([1, 2, 3]) }]);
      expect(solanaMockState.sendCalls[0][3]).toEqual({ commitment: 'confirmed' });

      const ledger = await request(app).get('/api/ledger').expect(200);
      expect(ledger.body[0].signature).toBe('mock-signature');
      await request(app).get('/api/services/supplier-search').set('x-payment-receipt', firstPayment.id).expect(200);
    } finally {
      await closeServer(server);
    }
  });

  it.each([
    { value: null },
    { value: { err: { code: 1 }, confirmationStatus: 'confirmed' } },
    { value: { err: null, confirmationStatus: 'processed' } }
  ] as const)('rejects a settlement when verification fails (%s)', async (status) => {
    solanaMockState.signatureStatus = status;
    const { app, server } = await startServer({ demoMode: false, realCredentials: true });
    try {
      const response = await request(app).post('/api/agent/run').send({ prompt: 'verification failure' }).expect(400);
      const failed = response.body.activities.find((activity: { label: string }) => activity.label === 'TASK FAILED');
      expect(failed.detail).toBe('Payment verification failed on Solana.');
      expect(response.body.payments).toBeUndefined();
      expect(await request(app).get('/api/services/supplier-search')).toHaveProperty('status', 402);
      expect((await request(app).get('/api/ledger')).body).toEqual([]);
    } finally {
      await closeServer(server);
    }
  });

  it('creates a merchant ATA when the account is missing', async () => {
    solanaMockState.getAccountMode = 'reject';
    const { app, server } = await startServer({ demoMode: false, realCredentials: true });
    try {
      await request(app).post('/api/agent/run').send({ prompt: 'create merchant ATA' }).expect(200);
      expect(solanaMockState.associatedAccountCalls).toHaveLength(3);
      expect(solanaMockState.transactions[0].instructions[0]).toEqual({
        type: 'create-associated-token-account',
        args: [solanaMockState.payerPublicKey, 'destination-token-account', solanaMockState.merchantPublicKey, solanaMockState.mintPublicKey]
      });
    } finally {
      await closeServer(server);
    }
  });

  it('does not create a merchant ATA when the account exists', async () => {
    const { app, server } = await startServer({ demoMode: false, realCredentials: true });
    try {
      await request(app).post('/api/agent/run').send({ prompt: 'existing merchant ATA' }).expect(200);
      expect(solanaMockState.associatedAccountCalls).toHaveLength(3);
      expect(solanaMockState.transactions.every((transaction) => transaction.instructions.every(
        (instruction) => (instruction as { type: string }).type !== 'create-associated-token-account'
      ))).toBe(true);
    } finally {
      await closeServer(server);
    }
  });
});
