import { env, assertEnvironment } from './config/environment.js';
import { checkDatabase } from './config/supabase.js';
import { createApp } from './app.js';

async function main() {
  assertEnvironment();
  const db = await checkDatabase(8000);
  if (db.ok) console.log('Supabase connected');
  else console.error(`WARNING: Supabase check failed (${db.error}). Did you run supabase/schema.sql? The API will keep running and /health will report database:"down".`);

  // Render injects PORT; bind to all interfaces so its load balancer can reach the service.
  const server = createApp().listen(env.port, env.host, () => console.log(`API listening on ${env.host}:${env.port} (${env.nodeEnv})`));
  server.keepAliveTimeout = 65_000;   // longer than Render's proxy idle timeout (avoids sporadic 502s)
  server.headersTimeout = 66_000;

  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received: shutting down gracefully`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  ['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
  process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));
}

main().catch((err) => { console.error(err.message); process.exit(1); });
