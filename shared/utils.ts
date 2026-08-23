import { NETWORK } from './services.js';

export function explorerTxUrl(signature: string) { return `https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`; }
export function formatUsdcAmount(amount: number) { return amount.toFixed(3); }
export function shortenSignature(value: string) { return `${value.slice(0, 5)}…${value.slice(-4)}`; }
export function errorToMessage(error: unknown, fallback = 'Unknown error') { return error instanceof Error ? error.message : fallback; }
