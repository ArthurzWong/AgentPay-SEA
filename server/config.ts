import 'dotenv/config';

export const port = Number(process.env.PORT || 8787);
export const demoMode = process.env.DEMO_MODE !== 'false';
