import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTestDatabase } from './test-database.js';

const testDatabase = createTestDatabase('auth_quiz_api');
const prisma = testDatabase.prisma;
const app = createApp(prisma);
const secret = process.env.JWT_SECRET ?? 'test-secret-that-is-at-least-32-characters-long';
let token = '';
let quizId = '';
let questionId = '';

beforeAll(async () => {
  await testDatabase.migrate();
  await prisma.admin.create({
    data: {
      username: `stage4-admin-${Date.now()}`,
      passwordHash: await bcrypt.hash('correct-password', 12)
    }
  });
});

afterAll(async () => {
  await testDatabase.disconnect();
});

describe('admin authentication', () => {
  it('logs in without exposing the password hash', async () => {
    const response = await request(app)
      .post('/api/admin/login')
      .send({ username: 'stage4-admin', password: 'correct-password' });

    expect(response.status).toBe(200);
    expect(response.body.data.token).toEqual(expect.any(String));
    expect(response.body.data.admin).toEqual({ id: expect.any(String), username: 'stage4-admin' });
    expect(response.body.data).not.toHaveProperty('passwordHash');
    token = response.body.data.token;
  });

  it('rejects invalid credentials and missing, invalid, or expired tokens', async () => {
    const invalidCredentials = await request(app)
      .post('/api/admin/login')
      .send({ username: 'stage4-admin', password: 'wrong-password' });
    expect(invalidCredentials.status).toBe(401);
    expect(invalidCredentials.body.error.code).toBe('INVALID_CREDENTIALS');

    const missing = await request(app).get('/api/quizzes');
    expect(missing.status).toBe(401);

    const invalid = await request(app).get('/api/quizzes').set('Authorization', 'Bearer invalid');
    expect(invalid.status).toBe(401);

    const expired = jwt.sign({ sub: 'admin', username: 'stage4-admin', role: 'admin' }, secret, {
      expiresIn: -1,
      issuer: 'glitch-in-reality-game-server'
    });
    const expiredResponse = await request(app)
      .get('/api/quizzes')
      .set('Authorization', `Bearer ${expired}`);
    expect(expiredResponse.status).toBe(401);
  });
});

describe('quiz and question management', () => {
  it('supports protected quiz CRUD and pagination', async () => {
    const unauthorized = await request(app).post('/api/quizzes').send({ title: 'No access' });
    expect(unauthorized.status).toBe(401);

    const created = await request(app)
      .post('/api/quizzes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'API quiz', description: 'Managed through the API' });
    expect(created.status).toBe(201);
    quizId = created.body.data.id;

    const list = await request(app)
      .get('/api/quizzes?page=1&pageSize=10')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((quiz: { id: string }) => quiz.id === quizId)).toBe(true);

    const updated = await request(app)
      .patch(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated API quiz' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.title).toBe('Updated API quiz');
  });

  it('validates question options and supports question/option management', async () => {
    const invalid = await request(app)
      .post(`/api/questions/quiz/${quizId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        order: 1,
        text: 'Invalid options',
        options: [
          { text: 'A', isCorrect: true },
          { text: 'B', isCorrect: true }
        ]
      });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const created = await request(app)
      .post(`/api/questions/quiz/${quizId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        order: 1,
        text: 'What is phishing?',
        options: [
          { text: 'A social engineering attack', isCorrect: true },
          { text: 'A backup strategy', isCorrect: false }
        ]
      });
    expect(created.status).toBe(201);
    questionId = created.body.data.id;

    const unsupportedMedia = await request(app)
      .post(`/api/media/questions/${questionId}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('not-an-image'), 'payload.txt');
    expect(unsupportedMedia.status).toBe(400);
    expect(unsupportedMedia.body.error.code).toBe('MEDIA_REQUIRED');

    const validMedia = await request(app)
      .post(`/api/media/questions/${questionId}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'question.png');
    expect(validMedia.status).toBe(201);
    const deletedMedia = await request(app)
      .delete(`/api/media/${validMedia.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deletedMedia.status).toBe(204);

    const fetched = await request(app)
      .get(`/api/questions/${questionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.options).toHaveLength(2);

    const extraOption = await request(app)
      .post(`/api/questions/${questionId}/options`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'A third choice', isCorrect: false });
    expect(extraOption.status).toBe(201);

    const notFound = await request(app)
      .get('/api/quizzes/cjld3w0qk0000qzrm3v5s9j8x')
      .set('Authorization', `Bearer ${token}`);
    expect(notFound.status).toBe(404);
  });

  it('supports deleting a question and quiz', async () => {
    const deletedQuestion = await request(app)
      .delete(`/api/questions/${questionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deletedQuestion.status).toBe(204);

    const deletedQuiz = await request(app)
      .delete(`/api/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deletedQuiz.status).toBe(204);
  });
});
