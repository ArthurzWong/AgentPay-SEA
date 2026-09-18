import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { clearTestEnvironment, resetSolanaMocks, restoreTestEnvironment, walletScript } from './helpers';

function runWalletScript(cwd: string) {
  const run = (args: string[]) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  const plain = run([walletScript]);
  if (plain.status !== 0 && plain.stderr.includes('require() of ES Module')) {
    return run(['--experimental-require-module', walletScript]);
  }
  return plain;
}

afterEach(() => {
  clearTestEnvironment();
  resetSolanaMocks();
});

afterAll(restoreTestEnvironment);

describe('devnet wallet generator', () => {
  it('writes a private .env with the expected wallet configuration', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agentpay-wallet-'));
    try {
      const result = runWalletScript(cwd);
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

  it('refuses to overwrite an existing private key and leaves .env untouched', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agentpay-wallet-'));
    const envPath = join(cwd, '.env');
    const original = 'SERVER_PRIVATE_KEY=already-present\nOTHER_SETTING=unchanged\n';
    try {
      writeFileSync(envPath, original);
      const result = runWalletScript(cwd);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('.env already has a SERVER_PRIVATE_KEY. Refusing to overwrite it.');
      expect(readFileSync(envPath, 'utf8')).toBe(original);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('writes a fresh .env in the current working directory', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agentpay-wallet-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(cwd);
      // The Keypair mock supplies deterministic fake keys for this in-process execution.
      // @ts-expect-error The JavaScript entrypoint intentionally has no exported API.
      await import('../scripts/create-devnet-wallet.mjs');
      expect(readFileSync(join(cwd, '.env'), 'utf8')).toContain('SERVER_PRIVATE_KEY=');
    } finally {
      process.chdir(previousCwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
