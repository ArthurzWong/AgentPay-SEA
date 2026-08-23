export type ServiceId = 'supplier-search' | 'company-verification' | 'esg';
export type Payment = { id: string; service: ServiceId; amount: number; status: 'confirmed' | 'demo'; signature: string | null; createdAt: string };
export type Activity = { label: string; detail?: string; tone: 'info' | 'payment' | 'success' | 'error'; signature?: string | null };
export type ServiceDefinition = { name: string; description: string };
export type ServiceSummary = ServiceDefinition & { id: ServiceId; price: number };
export type AgentRunResult = { supplier: string; cost: number; rating: number; verification: string; esg: number; renewable: number };
export type AgentRunResponse = { prompt: string; activities: Activity[]; payments: Payment[]; spent: number; remaining: number; result: AgentRunResult };
