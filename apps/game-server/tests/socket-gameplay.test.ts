import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient, QuizStatus } from '@prisma/client';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { RealtimeGameServer } from '../src/realtime/socket-server.js';

const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'quiz-platform-socket-'));
const databaseUrl = `file:${resolve(temporaryDirectory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = createApp(prisma);
const httpServer = createServer(app);
const realtime = new RealtimeGameServer(prisma, httpServer);
let baseUrl = '';
let adminToken = '';
let participantToken = '';
let participantId = '';
let sessionId = '';
type AckResponse = { success: boolean; error?: { code: string; message: string }; data?: unknown };

const waitForEvent = <T>(socket: ClientSocket, event: string): Promise<T> =>
  new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 3_000);
    socket.once(event, (payload: T) => {
      clearTimeout(timeout);
      resolvePromise(payload);
    });
  });

const connectClient = (token: string, role: 'host' | 'participant'): Promise<ClientSocket> =>
  new Promise((resolvePromise, reject) => {
    const socket = createClient(baseUrl, {
      auth: { token, role },
      transports: ['websocket']
    });
    socket.once('connect', () => resolvePromise(socket));
    socket.once('connect_error', reject);
  });

beforeAll(async () => {
  execFileSync(resolve('node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe'
  });
  await prisma.admin.create({
    data: { username: 'socket-admin', passwordHash: await bcrypt.hash('socket-password', 12) }
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
              { text: 'Unsafe option', isCorrect: false }
            ]
          }
        }
      }
    }
  });
  const login = await request(app).post('/api/admin/login').send({
    username: 'socket-admin',
    password: 'socket-password'
  });
  adminToken = login.body.data.token;
  const session = await prisma.gameSession.create({ data: { quizId: quiz.id, pin: '765432' } });
  sessionId = session.id;
  const joined = await request(app).post(`/api/sessions/join/${session.pin}`).send({ displayName: 'Socket participant' });
  participantToken = joined.body.data.connectionToken;
  participantId = joined.body.data.participant.id;
  await new Promise<void>((resolvePromise) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind');
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolvePromise();
    });
  });
});

afterAll(async () => {
  await realtime.close();
  await new Promise<void>((resolvePromise) => httpServer.close(() => resolvePromise()));
  await prisma.$disconnect();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('Socket.IO gameplay engine', () => {
  it('authenticates host and participant, starts a question, accepts an answer, and reveals safely', async () => {
    const host = await connectClient(adminToken, 'host');
    const participant = await connectClient(participantToken, 'participant');

    expect(host.connected).toBe(true);
    expect(participant.connected).toBe(true);

    await new Promise<void>((resolvePromise, reject) => {
      host.emit('host:join', { sessionId }, (response: AckResponse) =>
        response.success ? resolvePromise() : reject(response.error)
      );
    });
    await new Promise<void>((resolvePromise, reject) => {
      participant.emit('participant:join-game', { sessionId }, (response: AckResponse) =>
        response.success ? resolvePromise() : reject(response.error)
      );
    });

    const questionStarted = waitForEvent<{ questionId: string; options: Array<{ id: string }> }>(participant, 'question:started');
    await new Promise<void>((resolvePromise, reject) => {
      host.emit('host:start-question', { sessionId, questionIndex: 0 }, (response: AckResponse) =>
        response.success ? resolvePromise() : reject(response.error)
      );
    });
    const question = await questionStarted;
    expect(question.options).toHaveLength(2);
    const firstOption = question.options[0];
    expect(firstOption).toBeDefined();
    if (!firstOption) throw new Error('Question did not include an option');
    expect(firstOption).not.toHaveProperty('isCorrect');

    const reconnectingParticipant = await connectClient(participantToken, 'participant');
    const replayedQuestion = waitForEvent<{ questionId: string; options: Array<{ id: string }> }>(reconnectingParticipant, 'question:started');
    await new Promise<void>((resolvePromise, reject) => {
      reconnectingParticipant.emit('participant:reconnect', { sessionId }, (response: AckResponse) =>
        response.success ? resolvePromise() : reject(response.error)
      );
    });
    expect((await replayedQuestion).questionId).toBe(question.questionId);
    reconnectingParticipant.disconnect();

    const answerReceived = waitForEvent<{ participantId: string; questionId: string }>(host, 'answer:received');
    const answerAck = await new Promise<{ success: boolean; data?: { questionId: string } }>((resolvePromise) => {
      participant.emit(
        'participant:submit-answer',
        { sessionId, questionId: question.questionId, optionId: firstOption.id },
        resolvePromise
      );
    });
    expect(answerAck.success).toBe(true);
    expect((await answerReceived).participantId).toBe(participantId);
    expect(await prisma.answer.count({ where: { participantId } })).toBe(1);

    const reveal = waitForEvent<{ correctOptionId: string }>(participant, 'answer:revealed');
    const leaderboard = waitForEvent<{
      sessionId: string;
      entries: Array<{ totalScore: number; displayName: string }>;
    }>(participant, 'leaderboard:updated');
    await new Promise<void>((resolvePromise, reject) => {
      host.emit('host:reveal-answer', { sessionId }, (response: AckResponse) =>
        response.success ? resolvePromise() : reject(response.error)
      );
    });
    expect((await reveal).correctOptionId).toBe(firstOption.id);
    expect((await leaderboard).entries.find((entry) => entry.displayName === 'Socket participant')?.totalScore).toBe(1_000);
    expect((await prisma.gameSession.findUnique({ where: { id: sessionId } }))?.status).toBe('REVEAL');

    host.disconnect();
    participant.disconnect();
  });

  it('rejects invalid credentials and wrong-session participant room access', async () => {
    const invalid = createClient(baseUrl, {
      auth: { token: 'invalid', role: 'host' },
      transports: ['websocket']
    });
    await new Promise<void>((resolvePromise) => invalid.once('connect_error', () => resolvePromise()));
    invalid.close();

    const participant = await connectClient(participantToken, 'participant');
    const response = await new Promise<{ success: boolean; error?: { code: string } }>((resolvePromise) => {
      participant.emit('participant:join-game', { sessionId: 'cjld3w0qk0000qzrm3v5s9j8x' }, resolvePromise);
    });
    expect(response.success).toBe(false);
    expect(response.error?.code).toBe('UNAUTHORIZED');
    participant.disconnect();
  });
});
