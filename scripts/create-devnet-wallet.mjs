import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair } from '@solana/web3.js';

function fail(message, cause) {
  console.error(`\n${message}`);
  if (cause) console.error(cause);
  process.exit(1);
}

const envPath = resolve('.env');
if (existsSync(envPath)) {
  let content;
  try { content = readFileSync(envPath, 'utf8'); }
  catch (error) { fail(`Could not read ${envPath}. Check its permissions before rerunning.`, error); }
  if (content.includes('SERVER_PRIVATE_KEY=')) fail('.env already has a SERVER_PRIVATE_KEY. Refusing to overwrite it.');
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
try { writeFileSync(envPath, env, { mode: 0o600 }); }
catch (error) { fail(`Could not write ${envPath}. The generated keys were discarded; fix the path permissions and rerun.`, error); }

console.log('\nAgentPay Devnet wallets created. Private key is stored only in .env (gitignored).');
console.log(`\nFund this AGENT wallet with Devnet SOL and Devnet USDC:\n${agent.publicKey.toBase58()}`);
console.log(`\nMerchant wallet (receives USDC automatically):\n${merchant.publicKey.toBase58()}`);
console.log('\n1. Get Devnet SOL: https://faucet.solana.com');
console.log('2. Get Devnet USDC (select Solana Devnet): https://faucet.circle.com');
console.log('3. Change DEMO_MODE=false in .env, then run npm run dev.');
