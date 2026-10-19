import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const issuer = 'glitch-in-reality-game-server';

export interface AdminTokenPayload {
  sub: string;
  username: string;
  role: 'admin';
}

export const signAdminToken = (admin: Pick<AdminTokenPayload, 'sub' | 'username'>): string =>
  jwt.sign({ sub: admin.sub, username: admin.username, role: 'admin' }, env.JWT_SECRET, {
    expiresIn: '8h',
    issuer
  });

export const verifyAdminToken = (token: string): AdminTokenPayload => {
  const payload = jwt.verify(token, env.JWT_SECRET, { issuer });

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload.sub !== 'string' ||
    typeof payload.username !== 'string' ||
    payload.role !== 'admin'
  ) {
    throw new Error('Invalid admin token payload');
  }

  return {
    sub: payload.sub,
    username: payload.username,
    role: 'admin'
  };
};
