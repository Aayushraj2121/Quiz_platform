
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import { MediaType, QuizStatus } from '@prisma/client';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { RealtimeGameServer } from '../src/realtime/socket-server.js';
import { createTestDatabase } from './test-database.js';

const testDatabase = createTestDatabase('socket_gameplay');
const prisma = testDatabase.prisma;

const app = createApp(prisma);
const httpServer = createServer(app);
const realtime = new RealtimeGameServer(prisma, httpServer);

let baseUrl = '';
let adminToken = '';
let participantToken = '';
let participantId = '';
let sessionId = '';

type AckResponse = {
  success: boolean;
  error?: { code: string; message: string };
  data?: unknown;
};

type StartedQuestion = {
  questionId: string;
  mediaMimeType: string | null;
  options: Array<{ id: string }>;
};

const waitForEvent = <T>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 10_000
): Promise<T> =>
  new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const handler = (payload: T) => {
      clearTimeout(timeout);
      resolvePromise(payload);
    };

    socket.once(event, handler);
  });

const connectClient = (
  token: string,
  role: 'host' | 'participant'
): Promise<ClientSocket> =>
  new Promise((resolvePromise, reject) => {
    const socket = createClient(baseUrl, {
      auth: { token, role },
      transports: ['websocket'],
    });

    socket.once('connect', () => resolvePromise(socket));
    socket.once('connect_error', (error) => {
      socket.close();
      reject(error);
    });
  });

const emitAck = <T extends AckResponse = AckResponse>(
  socket: ClientSocket,
  event: string,
  payload: Record<string, unknown>
): Promise<T> =>
  new Promise((resolvePromise, reject) => {
    socket.emit(event, payload, (response: T) => {
      if (response?.success) {
        resolvePromise(response);
      } else {
        reject(
          new Error(
            response?.error?.message ??
              response?.error?.code ??
              `${event} failed`
          )
        );
      }
    });
  });

beforeAll(async () => {
  await testDatabase.migrate();

  const testAdminUsername = `socket-admin-${Date.now()}`;
  const testSessionPin = String(
    100000 + Math.floor(Math.random() * 900000)
  );

  await prisma.admin.create({
    data: {
      username: testAdminUsername,
      passwordHash: await bcrypt.hash('socket-password', 12),
    },
  });

  const quiz = await prisma.quiz.create({
    data: {
      title: 'Socket quiz',
      status: QuizStatus.PUBLISHED,
      questions: {
        create: {
          order: 1,
          text: 'Which option is safe?',
          timerSeconds: 10,
          options: {
            create: [
              { text: 'Safe option', isCorrect: true },
              { text: 'Unsafe option', isCorrect: false },
            ],
          },
        },
      },
    },
  });

  const question = await prisma.question.findFirstOrThrow({
    where: { quizId: quiz.id },
  });

  const media = await prisma.mediaAsset.create({
    data: {
      filePath: '/tmp/socket-gameplay-question.mp4',
      mediaType: MediaType.VIDEO,
      originalName: 'question.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 8,
    },
  });

  await prisma.question.update({
    where: { id: question.id },
    data: { mediaAssetId: media.id },
  });

  const login = await request(app).post('/api/admin/login').send({
    username: testAdminUsername,
    password: 'socket-password',
  });

  expect(login.status).toBe(200);
  expect(login.body.data?.token).toBeTruthy();
  adminToken = login.body.data.token;

  const session = await prisma.gameSession.create({
    data: {
      quizId: quiz.id,
      pin: testSessionPin,
    },
  });

  sessionId = session.id;

  const joined = await request(app)
    .post(`/api/sessions/join/${session.pin}`)
    .send({ displayName: 'Socket participant' });

  expect(joined.status).toBe(201);
  expect(joined.body.data?.connectionToken).toBeTruthy();

  participantToken = joined.body.data.connectionToken;
  participantId = joined.body.data.participant.id;

  await new Promise<void>((resolvePromise, reject) => {
    httpServer.once('error', reject);

    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.removeAllListeners('error');

      const address = httpServer.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Test server did not bind to a TCP port'));
        return;
      }

      baseUrl = `http://127.0.0.1:${address.port}`;
      resolvePromise();
    });
  });
}, 60_000);

afterAll(async () => {
  try {
    await realtime.close();
  } finally {
    try {
      if (httpServer.listening) {
        await new Promise<void>((resolvePromise, reject) => {
          httpServer.close((error) => {
            if (error) reject(error);
            else resolvePromise();
          });
        });
      }
    } finally {
      await testDatabase.disconnect();
    }
  }
}, 60_000);

describe('Socket.IO gameplay engine', () => {
  it(
    'authenticates host and participant, starts a question, accepts an answer, and reveals safely',
    async () => {
      const host = await connectClient(adminToken, 'host');
      const participant = await connectClient(
        participantToken,
        'participant'
      );

      let reconnectingParticipant: ClientSocket | undefined;

      try {
        expect(host.connected).toBe(true);
        expect(participant.connected).toBe(true);

        await emitAck(host, 'host:join', { sessionId });
        await emitAck(participant, 'participant:join-game', {
          sessionId,
        });

        const questionStarted = waitForEvent<StartedQuestion>(
          participant,
          'question:started'
        );

        await emitAck(host, 'host:start-question', {
          sessionId,
          questionIndex: 0,
        });

        const question = await questionStarted;

        expect(question.options).toHaveLength(2);
        expect(question.mediaMimeType).toBe('video/mp4');

        const firstOption = question.options[0];

        expect(firstOption).toBeDefined();

        if (!firstOption) {
          throw new Error('Question did not include an option');
        }

        expect(firstOption).not.toHaveProperty('isCorrect');

        const invalidOption = await new Promise<AckResponse>(
          (resolvePromise, reject) => {
            participant.emit(
              'participant:submit-answer',
              {
                sessionId,
                questionId: question.questionId,
                optionId: 'c123456789012345678901234',
              },
              resolvePromise
            );

            setTimeout(
              () => reject(new Error('Timed out waiting for invalid-answer acknowledgement')),
              10_000
            );
          }
        );

        expect(invalidOption).toMatchObject({
          success: false,
          error: { code: 'INVALID_OPTION' },
        });

        reconnectingParticipant = await connectClient(
          participantToken,
          'participant'
        );

        const replayedQuestion = waitForEvent<{
          questionId: string;
          options: Array<{ id: string }>;
        }>(reconnectingParticipant, 'question:started');

        await emitAck(reconnectingParticipant, 'participant:reconnect', {
          sessionId,
        });

        expect((await replayedQuestion).questionId).toBe(
          question.questionId
        );

        reconnectingParticipant.disconnect();
        reconnectingParticipant = undefined;

        const answerReceived = waitForEvent<{
          participantId: string;
          questionId: string;
        }>(host, 'answer:received');

        const answerAck = await new Promise<{
          success: boolean;
          data?: { questionId: string };
          error?: { code: string; message: string };
        }>((resolvePromise, reject) => {
          participant.emit(
            'participant:submit-answer',
            {
              sessionId,
              questionId: question.questionId,
              optionId: firstOption.id,
            },
            resolvePromise
          );

          setTimeout(
            () => reject(new Error('Timed out waiting for answer acknowledgement')),
            10_000
          );
        });

        expect(answerAck.success).toBe(true);
        expect((await answerReceived).participantId).toBe(participantId);

        expect(
          await prisma.answer.count({
            where: { participantId },
          })
        ).toBe(1);

        const reveal = waitForEvent<{ correctOptionId: string }>(
          participant,
          'answer:revealed'
        );

        const leaderboard = waitForEvent<{
          sessionId: string;
          entries: Array<{
            totalScore: number;
            displayName: string;
          }>;
        }>(participant, 'leaderboard:updated');

        await emitAck(host, 'host:reveal-answer', { sessionId });

        expect((await reveal).correctOptionId).toBe(firstOption.id);

        const participantScore = (
          await leaderboard
        ).entries.find(
          (entry) => entry.displayName === 'Socket participant'
        )?.totalScore;

        expect(participantScore).toBeDefined();
        expect(participantScore).toBeGreaterThan(0);
        expect(participantScore).toBeLessThanOrEqual(1_000);

        expect(
          (await prisma.gameSession.findUnique({
            where: { id: sessionId },
          }))?.status
        ).toBe('REVEAL');
      } finally {
        reconnectingParticipant?.disconnect();
        host.disconnect();
        participant.disconnect();
      }
    },
    60_000
  );

  it(
    'rejects invalid credentials and wrong-session participant room access',
    async () => {
      const invalid = createClient(baseUrl, {
        auth: { token: 'invalid', role: 'host' },
        transports: ['websocket'],
      });

      try {
        await new Promise<void>((resolvePromise, reject) => {
          const timeout = setTimeout(() => {
            invalid.close();
            reject(new Error('Timed out waiting for invalid-token rejection'));
          }, 10_000);

          invalid.once('connect_error', () => {
            clearTimeout(timeout);
            resolvePromise();
          });

          invalid.once('connect', () => {
            clearTimeout(timeout);
            reject(
              new Error('Socket unexpectedly connected with invalid credentials')
            );
          });
        });
      } finally {
        invalid.close();
      }

      const participant = await connectClient(
        participantToken,
        'participant'
      );

      try {
        const response = await new Promise<{
          success: boolean;
          error?: { code: string };
        }>((resolvePromise, reject) => {
          participant.emit(
            'participant:join-game',
            { sessionId: 'cjld3w0qk0000qzrm3v5s9j8x' },
            resolvePromise
          );

          setTimeout(
            () => reject(new Error('Timed out waiting for wrong-session acknowledgement')),
            10_000
          );
        });

        expect(response.success).toBe(false);
        expect(response.error?.code).toBe('UNAUTHORIZED');
      } finally {
        participant.disconnect();
      }
    },
    30_000
  );
});
