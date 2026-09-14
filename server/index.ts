/** Entry point. Fails fast if the database is unreachable — a server that starts
 *  and then 500s on every request is harder to diagnose than one that refuses. */

import { createApp } from './app';
import { env } from './env';
import { checkConnection, closePool } from './db/pool';
import { purgeExpiredSessions } from './auth/sessions';

async function main(): Promise<void> {
  const info = await checkConnection().catch((error: Error) => {
    console.error(`Cannot reach the database: ${error.message}`);
    console.error('Check DB_HOST, DB_NAME, DB_USER and DB_PASSWORD in .env.');
    process.exit(1);
  });

  const app = createApp();
  // Express 5 calls this on failure too, passing the error. Ignoring the argument
  // once printed "API on 127.0.0.1:3001" on a server where another site already
  // held that port: the process stayed up, claimed success, and served nothing.
  // A port that is taken must stop the process loudly, so a process manager
  // shows it crashing instead of "online".
  const server = app.listen(env.PORT, env.HOST, (error?: Error) => {
    if (error) {
      const code = (error as NodeJS.ErrnoException).code;
      console.error(code === 'EADDRINUSE'
        ? `Port ${env.PORT} on ${env.HOST} is already in use by another program. Set a free PORT in .env.`
        : `Could not listen on ${env.HOST}:${env.PORT}: ${error.message}`);
      closePool().finally(() => process.exit(1));
      return;
    }
    console.log(`Marketing Resource CRM API on ${env.HOST}:${env.PORT}`);
    console.log(`  database ${info.database} (MySQL ${info.version})`);
    console.log(`  env ${env.NODE_ENV}, cookies ${env.cookieSecure ? 'Secure' : 'not Secure'}`);
  });

  // Expired sessions are removed as they are encountered; this sweeps the ones
  // nobody comes back for.
  const sweep = setInterval(() => {
    purgeExpiredSessions().catch((error: Error) => console.error('Session sweep failed:', error.message));
  }, 60 * 60_000);
  sweep.unref();

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(() => {
      closePool().finally(() => process.exit(0));
    });
    // Do not let a hung connection keep the process alive indefinitely.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: Error) => {
  console.error('Failed to start:', error.message);
  process.exit(1);
});
