import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { clearTestEnvironment, resetSolanaMocks, restoreTestEnvironment } from './helpers';

afterEach(() => {
  clearTestEnvironment();
  resetSolanaMocks();
});

afterAll(restoreTestEnvironment);

describe('Vercel API handler', () => {
  it('delegates requests to the Express application', async () => {
    vi.resetModules();
    const { default: handler } = await import('../api/[...path].ts');
    const response = await request(handler as unknown as import('node:http').RequestListener).get('/api/config').expect(200);
    expect(response.body).toEqual(expect.objectContaining({ demoMode: true, network: 'devnet' }));
  });
});
