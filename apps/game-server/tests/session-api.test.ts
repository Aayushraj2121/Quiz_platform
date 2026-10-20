import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuizStatus, SessionStatus } from '@prisma/client';
import { createApp } from '../src/app.js';
import { createTestDatabase } from './test-database.js';

const testDatabase = createTestDatabase('session_api');
const prisma = testDatabase.prisma;
const app = createApp(prisma);

const testAdminUsername = 'session-admin-' + Date.now();

let adminToken = '';
let quizId = '';
let sessionId = '';
let joinSessionId = '';
let joinPin = '';
let participantToken = '';

beforeAll(async () => {
  await testDatabase.migrate();

  await prisma.admin.create({
    data: {
      username: testAdminUsername,
      passwordHash: await bcrypt.hash('session-password', 12)
    }
  });

  const quiz = await prisma.quiz.create({
    data: {
      title: 'Session quiz',
      status: QuizStatus.PUBLISHED,
      questions: {
        create: {
          order: 1,
          text: 'Session question',
          options: {
            create: [
              { text: 'Correct', isCorrect: true },
              { text: 'Incorrect', isCorrect: false }
            ]
          }
        }
      }
    }
  });

  quizId = quiz.id;

  const login = await request(app)
    .post('/api/admin/login')
    .send({
      username: testAdminUsername,
      password: 'session-password'
    });

  expect(login.status).toBe(200);
  adminToken = login.body.data.token;
}, 60000);

afterAll(async () => {
  await testDatabase.disconnect();
});

describe('session management', () => {
  it('requires admin authorization and rejects unknown or ineligible quizzes', async () => {
    const unauthorized = await request(app)
      .post('/api/sessions')
      .send({ quizId });

    expect(unauthorized.status).toBe(401);

    const unknown = await request(app)
      .post('/api/sessions')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ quizId: 'cjld3w0qk0000qzrm3v5s9j8x' });

    expect(unknown.status).toBe(404);

    const draft = await prisma.quiz.create({
      data: { title: 'Draft quiz' }
    });

    const ineligible = await request(app)
      .post('/api/sessions')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ quizId: draft.id });

    expect(ineligible.status).toBe(400);
    expect(ineligible.body.error.code).toBe('QUIZ_NOT_ELIGIBLE');
  });

  it('creates unique PINs, lists, retrieves, and transitions sessions', async () => {
    const created = await request(app)
      .post('/api/sessions')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ quizId });

    expect(created.status).toBe(201);
    expect(created.body.data.pin).toMatch(/^\d{6}$/);

    sessionId = created.body.data.id;
    const firstPin = created.body.data.pin;

    const second = await request(app)
      .post('/api/sessions')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ quizId });

    expect(second.status).toBe(201);
    expect(second.body.data.pin).not.toBe(firstPin);

    joinSessionId = second.body.data.id;
    joinPin = second.body.data.pin;

    const list = await request(app)
      .get('/api/sessions?page=1&pageSize=10')
      .set('Authorization', 'Bearer ' + adminToken);

    expect(list.status).toBe(200);
    expect(
      list.body.data.items.some(
        (item: { id: string }) => item.id === sessionId
      )
    ).toBe(true);

    const detail = await request(app)
      .get('/api/sessions/' + sessionId)
      .set('Authorization', 'Bearer ' + adminToken);

    expect(detail.status).toBe(200);
    expect(detail.body.data).not.toHaveProperty(
      'participants[0].tokenHash'
    );

    const invalidTransition = await request(app)
      .patch('/api/sessions/' + sessionId + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'LEADERBOARD' });

    expect(invalidTransition.status).toBe(409);

    const started = await request(app)
      .patch('/api/sessions/' + sessionId + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'QUESTION' });

    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('QUESTION');
  });
});

describe('participant joining', () => {
  it('joins valid lobby sessions and rejects invalid or duplicate joins', async () => {
    const valid = await request(app)
      .post('/api/sessions/join/' + joinPin)
      .send({
        displayName: 'Alice',
        email: 'alice@example.com',
        studentId: 'S-1'
      });

    expect(valid.status).toBe(201);
    expect(valid.body.data.participant.displayName).toBe('Alice');
    expect(
      valid.body.data.participant.participantIdentifier
    ).toEqual(expect.any(String));

    participantToken = valid.body.data.connectionToken;

    expect(valid.body.data.participant).not.toHaveProperty('tokenHash');

    expect(valid.body.data.session).toEqual({
      id: joinSessionId,
      pin: joinPin,
      status: 'LOBBY',
      quiz: { id: quizId, title: 'Session quiz' },
      joinUrl: expect.stringContaining('/join/' + joinPin)
    });

    const leaderboard = await request(app)
      .get('/api/sessions/' + joinSessionId + '/leaderboard')
      .set('Authorization', 'Bearer ' + participantToken);

    expect(leaderboard.status).toBe(200);
    expect(leaderboard.body.data[0]).toMatchObject({
      displayName: 'Alice',
      rank: 1,
      totalScore: 0,
      correctCount: 0
    });

    const participantResults = await request(app)
      .get('/api/results/sessions/' + joinSessionId)
      .set('Authorization', 'Bearer ' + participantToken);

    expect(participantResults.status).toBe(200);
    expect(participantResults.body.data.participants).toHaveLength(1);
    expect(participantResults.body.data.leaderboard).toHaveLength(1);
    expect(participantResults.body.data.podium).toHaveLength(0);
    expect(
      participantResults.body.data.participants[0]
    ).not.toHaveProperty('email');

    const adminResults = await request(app)
      .get('/api/results/sessions/' + joinSessionId)
      .set('Authorization', 'Bearer ' + adminToken);

    expect(adminResults.status).toBe(200);
    expect(adminResults.body.data.participants).toHaveLength(1);

    const csv = await request(app)
      .get('/api/results/sessions/' + joinSessionId + '/export.csv')
      .set('Authorization', 'Bearer ' + adminToken);

    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('participantIdentifier,displayName');
    expect(csv.text).toContain('Alice');

    const duplicate = await request(app)
      .post('/api/sessions/join/' + joinPin)
      .send({ displayName: 'Alice' });

    expect(duplicate.status).toBe(201);
    expect(duplicate.body.data.participant.displayName).toBe('Alice (1)');

    const invalidPin = await request(app)
      .post('/api/sessions/join/000000')
      .send({ displayName: 'Unknown' });

    expect(invalidPin.status).toBe(404);

    const oversizedName = await request(app)
      .post('/api/sessions/join/' + joinPin)
      .send({ displayName: 'x'.repeat(41) });

    expect(oversizedName.status).toBe(400);

    const malformedPin = await request(app)
      .post('/api/sessions/join/not-a-pin')
      .send({ displayName: 'Unknown' });

    expect(malformedPin.status).toBe(400);
  });

  it('handles concurrent duplicate joins atomically', async () => {
    const concurrentResults = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post('/api/sessions/join/' + joinPin)
          .send({ displayName: 'Concurrent' })
      )
    );

    expect(
      concurrentResults.filter((response) => response.status === 201)
    ).toHaveLength(4);

    expect(
      new Set(
        concurrentResults.map(
          (response) => response.body.data.participant.displayName
        )
      ).size
    ).toBe(4);
  });

  it('rejects joins after the lobby closes', async () => {
    const ended = await request(app)
      .patch('/api/sessions/' + sessionId + '/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'ENDED' });

    expect(ended.status).toBe(200);

    // Generate a six-digit numeric PIN accepted by the join endpoint.
    const sessionPin = String(
      100000 + Math.floor(Math.random() * 900000)
    );

    const session = await prisma.gameSession.create({
      data: {
        quizId,
        pin: sessionPin,
        status: SessionStatus.ENDED
      }
    });

    const rejected = await request(app)
      .post('/api/sessions/join/' + session.pin)
      .send({ displayName: 'Late' });

    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('SESSION_NOT_JOINABLE');

    await prisma.gameSession.update({
      where: { id: joinSessionId },
      data: { status: SessionStatus.PODIUM }
    });

    const certificate = await request(app).get(
      '/api/cert/' + participantToken
    );

    expect(certificate.status).toBe(200);
    expect(certificate.body.data).toMatchObject({
      participantName: 'Alice',
      event: 'GLITCH IN REALITY',
      verificationCode: expect.any(String)
    });

    const verified = await request(app).get(
      '/api/cert/verify/' + certificate.body.data.verificationCode
    );

    expect(verified.status).toBe(200);
  });
});