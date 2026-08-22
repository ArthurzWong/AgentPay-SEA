// Serverless entry point: Vercel maps every /api/* request to the existing Express app.
import { app } from '../server/index.js';

export default function handler(request: Parameters<typeof app>[0], response: Parameters<typeof app>[1]) {
  return app(request, response);
}
