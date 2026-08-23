import { app } from './index.js';
import { demoMode, port } from './config.js';

const server = app.listen(port, () => console.log(`AgentPay API listening on http://localhost:${port} (${demoMode ? 'demo' : 'real settlement'} mode)`));

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Stop the other process or set PORT to a free port.`);
  else console.error('AgentPay API failed to start:', error);
  process.exit(1);
});

// Without these the process can die (or keep running degraded) without any explanation in the dev console.
process.on('unhandledRejection', reason => { console.error('Unhandled promise rejection:', reason); });
process.on('uncaughtException', error => { console.error('Uncaught exception:', error); process.exit(1); });
