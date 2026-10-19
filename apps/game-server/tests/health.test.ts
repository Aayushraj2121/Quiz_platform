import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('returns a healthy service response', async () => {
    const response = await request(createApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        status: 'ok',
        service: 'game-server'
      }
    });
    expect(response.body.data.timestamp).toEqual(expect.any(String));
  });
});

describe('unknown routes', () => {
  it('returns the standard error shape', async () => {
    const response = await request(createApp()).get('/api/unknown');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET /api/unknown was not found'
      }
    });
  });
});
