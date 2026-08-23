import { app } from './index.js';

const port = Number(process.env.PORT || 8787);
const server = app.listen(port, () => console.log(`AgentPay API listening on http://localhost:${port} (${process.env.DEMO_MODE !== 'false' ? 'demo' : 'real settlement'} mode)`));

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Stop the other process or set PORT to a free port.`);
  else console.error('AgentPay API failed to start:', error);
  process.exit(1);
});

// Without these the process can die (or keep running degraded) without any explanation in the dev console.
process.on('unhandledRejection', reason => { console.error('Unhandled promise rejection:', reason); });
process.on('uncaughtException', error => { console.error('Uncaught exception:', error); process.exit(1); });
