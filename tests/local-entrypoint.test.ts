import { once } from 'node:events';
import { spawn } from 'node:child_process';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { clearTestEnvironment, findFreePort, resetSolanaMocks, restoreTestEnvironment } from './helpers';

const projectRoot = process.cwd();

async function waitForReady(url: string, child: ReturnType<typeof spawn>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`local server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(250) });
      if (response.ok) return;
    } catch {
      // Keep polling until the startup timeout expires.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stopChild(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out stopping local server')), 2_000))
  ]).catch(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
}

afterEach(() => {
  clearTestEnvironment();
  resetSolanaMocks();
});

afterAll(restoreTestEnvironment);

describe('server/local.ts entrypoint', () => {
  it('starts a listener and serves the config endpoint', async () => {
    const port = await findFreePort();
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/local.ts'], {
      cwd: projectRoot,
      env: { ...process.env, PORT: String(port), DEMO_MODE: 'true' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
      await waitForReady(`http://127.0.0.1:${port}/api/config`, child, 10_000);
      await request(`http://127.0.0.1:${port}`).get('/api/config').expect(200);
    } finally {
      await stopChild(child);
    }
  });
});
