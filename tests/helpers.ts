import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { vi } from 'vitest';

export const solanaMockState = {
  getAccountMode: 'resolve' as 'resolve' | 'reject',
  signature: 'mock-signature',
  signatureStatus: { value: { err: null, confirmationStatus: 'confirmed' as string } } as {
    value: { err: unknown; confirmationStatus: string } | null;
  },
  connectionArgs: [] as unknown[],
  signatureStatusCalls: [] as unknown[][],
  associatedAddressCalls: [] as unknown[][],
  associatedAccountCalls: [] as unknown[][],
  transferCalls: [] as unknown[][],
  sendCalls: [] as unknown[][],
  transactions: [] as FakeTransaction[],
  payerPublicKey: null as FakePublicKey | null,
  merchantPublicKey: null as FakePublicKey | null,
  mintPublicKey: null as FakePublicKey | null
};

class FakePublicKey {
  constructor(readonly value: string) {}

  toBase58() {
    return this.value;
  }
}

class FakeTransaction {
  instructions: unknown[] = [];

  constructor() {
    solanaMockState.transactions.push(this);
  }

  add(...instructions: unknown[]) {
    this.instructions.push(...instructions);
    return this;
  }
}

const mockGetAccount = vi.fn((...args: unknown[]) => {
  solanaMockState.associatedAccountCalls.push(args);
  return solanaMockState.getAccountMode === 'reject'
    ? Promise.reject(new Error('merchant ATA missing'))
    : Promise.resolve({});
});
const mockGetAssociatedTokenAddress = vi.fn((...args: unknown[]) => {
  solanaMockState.associatedAddressCalls.push(args);
  return solanaMockState.associatedAddressCalls.length % 2 === 1 ? 'source-token-account' : 'destination-token-account';
});
const mockCreateAssociatedTokenAccountInstruction = vi.fn((...args: unknown[]) => {
  const instruction = { type: 'create-associated-token-account', args };
  return instruction;
});
const mockCreateTransferCheckedInstruction = vi.fn((...args: unknown[]) => {
  solanaMockState.transferCalls.push(args);
  return { type: 'transfer-checked', args };
});
const mockSendAndConfirmTransaction = vi.fn(async (...args: unknown[]) => {
  solanaMockState.sendCalls.push(args);
  return solanaMockState.signature;
});
const mockGetSignatureStatus = vi.fn(async (...args: unknown[]) => {
  solanaMockState.signatureStatusCalls.push(args);
  return solanaMockState.signatureStatus;
});

vi.mock('@solana/web3.js', () => ({
  Connection: class {
    constructor(...args: unknown[]) {
      solanaMockState.connectionArgs = args;
    }

    getSignatureStatus(...args: unknown[]) {
      return mockGetSignatureStatus(...args);
    }
  },
  Keypair: {
    fromSecretKey: (secretKey: Uint8Array) => {
      const publicKey = new FakePublicKey('payer-public-key');
      solanaMockState.payerPublicKey = publicKey;
      return { publicKey, secretKey };
    },
    generate: () => {
      const publicKey = new FakePublicKey('11111111111111111111111111111111');
      return { publicKey, secretKey: Uint8Array.from([1, 2, 3]) };
    }
  },
  PublicKey: class extends FakePublicKey {
    constructor(value: string) {
      super(value);
      if (value === 'fake-usdc-mint') solanaMockState.mintPublicKey = this;
      if (value === 'fake-merchant-wallet') solanaMockState.merchantPublicKey = this;
    }
  },
  Transaction: FakeTransaction,
  sendAndConfirmTransaction: mockSendAndConfirmTransaction
}));

vi.mock('@solana/spl-token', () => ({
  createAssociatedTokenAccountInstruction: mockCreateAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction: mockCreateTransferCheckedInstruction,
  getAccount: mockGetAccount,
  getAssociatedTokenAddress: mockGetAssociatedTokenAddress
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

export type ServerModule = typeof import('../server/index.ts');

export function clearTestEnvironment() {
  for (const key of envKeys) delete process.env[key];
}

export function restoreTestEnvironment() {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

export function resetSolanaMocks() {
  solanaMockState.getAccountMode = 'resolve';
  solanaMockState.signature = 'mock-signature';
  solanaMockState.signatureStatus = { value: { err: null, confirmationStatus: 'confirmed' } };
  solanaMockState.connectionArgs = [];
  solanaMockState.signatureStatusCalls = [];
  solanaMockState.associatedAddressCalls = [];
  solanaMockState.associatedAccountCalls = [];
  solanaMockState.transferCalls = [];
  solanaMockState.sendCalls = [];
  solanaMockState.transactions = [];
  solanaMockState.payerPublicKey = null;
  solanaMockState.merchantPublicKey = null;
  solanaMockState.mintPublicKey = null;
  vi.clearAllMocks();
}

export async function importServer(options: {
  demoMode?: boolean;
  port?: number;
  realCredentials?: boolean;
} = {}): Promise<ServerModule> {
  vi.resetModules();
  clearTestEnvironment();
  if (options.demoMode !== undefined) process.env.DEMO_MODE = String(options.demoMode);
  if (options.port !== undefined) process.env.PORT = String(options.port);
  if (options.realCredentials) {
    process.env.SERVER_PRIVATE_KEY = '[1,2,3]';
    process.env.MERCHANT_WALLET = 'fake-merchant-wallet';
    process.env.USDC_MINT = 'fake-usdc-mint';
  }
  return import('../server/index.ts');
}

export async function findFreePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine an ephemeral port.');
  const port = address.port;
  await new Promise<void>((resolveClose, rejectClose) => probe.close((error) => error ? rejectClose(error) : resolveClose()));
  return port;
}

export async function startServer(options: {
  demoMode?: boolean;
  realCredentials?: boolean;
} = {}) {
  const port = await findFreePort();
  const module = await importServer({ ...options, port });
  const server = module.app.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return { ...module, server };
}

export async function closeServer(server: Server) {
  if (server.listening) {
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
}

export const walletScript = resolve('scripts/create-devnet-wallet.mjs');
