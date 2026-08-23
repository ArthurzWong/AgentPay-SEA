import { app } from './index.js';
import { demoMode, port } from './config.js';

app.listen(port, () => console.log(`AgentPay API listening on http://localhost:${port} (${demoMode ? 'demo' : 'real settlement'} mode)`));
