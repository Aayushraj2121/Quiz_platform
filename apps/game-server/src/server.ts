import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { disconnectDatabase, prisma } from './db/client.js';
import { RealtimeGameServer } from './realtime/socket-server.js';

const app = createApp();
const server = createServer(app);
const realtime = new RealtimeGameServer(prisma, server);

server.listen(env.PORT, env.HOST, () => {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Game server started',
      host: env.HOST,
      port: env.PORT,
      environment: env.NODE_ENV
    })
  );
});

const shutdown = (signal: string) => {
  console.log(JSON.stringify({ level: 'info', message: 'Shutting down game server', signal }));
  void realtime.close();
  server.close((error) => {
    if (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'Server shutdown failed',
          error: error.message
        })
      );
      process.exitCode = 1;
      return;
    }

    void disconnectDatabase()
      .then(() => {
        process.exitCode = 0;
      })
      .catch((disconnectError: unknown) => {
        console.error(
          JSON.stringify({
            level: 'error',
            message: 'Database shutdown failed',
            error: disconnectError instanceof Error ? disconnectError.message : String(disconnectError)
          })
        );
        process.exitCode = 1;
      });
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
