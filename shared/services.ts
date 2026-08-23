import type { ServiceDefinition, ServiceId } from './types.js';

export const NETWORK = 'devnet';
export const NETWORK_LABEL = `${NETWORK[0].toUpperCase()}${NETWORK.slice(1)}`;
export const SOLANA_NETWORK = `solana-${NETWORK}`;
export const BUDGET = 0.05;
export const SERVICE_PRICES: Record<ServiceId, number> = { 'supplier-search': 0.002, 'company-verification': 0.001, esg: 0.005 };
export const SERVICE_DEFINITIONS: Record<ServiceId, ServiceDefinition> = {
  'supplier-search': { name: 'Supplier Intelligence', description: 'Synthetic Malaysian solar supplier shortlist.' },
  'company-verification': { name: 'Company Verification', description: 'Synthetic company registration verification.' },
  esg: { name: 'ESG Intelligence', description: 'Synthetic ESG profile for supplier evaluation.' }
};
export const SERVICE_IDS = Object.keys(SERVICE_PRICES) as ServiceId[];
