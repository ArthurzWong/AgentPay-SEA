import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair } from '@solana/web3.js';

const envPath = resolve('.env');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  if (content.includes('SERVER_PRIVATE_KEY=')) throw new Error('.env already has a SERVER_PRIVATE_KEY. Refusing to overwrite it.');
}

const agent = Keypair.generate();
const merchant = Keypair.generate();
const env = [
  'DEMO_MODE=true',
  'PORT=8787',
  'RPC_URL=https://api.devnet.solana.com',
  `SERVER_PRIVATE_KEY=${JSON.stringify(Array.from(agent.secretKey))}`,
  `MERCHANT_WALLET=${merchant.publicKey.toBase58()}`,
  'USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  'LLM_API_KEY='
].join('\n') + '\n';
writeFileSync(envPath, env, { mode: 0o600 });

console.log('\nAgentPay Devnet wallets created. Private key is stored only in .env (gitignored).');
console.log(`\nFund this AGENT wallet with Devnet SOL and Devnet USDC:\n${agent.publicKey.toBase58()}`);
console.log(`\nMerchant wallet (receives USDC automatically):\n${merchant.publicKey.toBase58()}`);
console.log('\n1. Get Devnet SOL: https://faucet.solana.com');
console.log('2. Get Devnet USDC (select Solana Devnet): https://faucet.circle.com');
console.log('3. Change DEMO_MODE=false in .env, then run npm run dev.');
