import { app } from './index.js';

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`AgentPay API listening on http://localhost:${port} (${process.env.DEMO_MODE !== 'false' ? 'demo' : 'real settlement'} mode)`));
