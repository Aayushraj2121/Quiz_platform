import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

const issuer = 'glitch-in-reality-game-server';

export interface AdminTokenPayload {
  sub: string;
  username: string;
  role: 'admin';
}

export interface ParticipantTokenPayload {
  sub: string;
  sessionId: string;
  participantIdentifier: string;
  role: 'participant';
}

export const signAdminToken = (admin: Pick<AdminTokenPayload, 'sub' | 'username'>): string =>
  jwt.sign({ sub: admin.sub, username: admin.username, role: 'admin' }, env.JWT_SECRET, {
    expiresIn: '7d',
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

export const signParticipantToken = (
  participant: Pick<ParticipantTokenPayload, 'sub' | 'sessionId' | 'participantIdentifier'>
): string =>
  jwt.sign(
    { sub: participant.sub, sessionId: participant.sessionId, participantIdentifier: participant.participantIdentifier, role: 'participant' },
    env.JWT_SECRET,
    { expiresIn: '7d', issuer }
  );

export const verifyParticipantToken = (token: string): ParticipantTokenPayload => {
  const payload = jwt.verify(token, env.JWT_SECRET, { issuer });
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload.sub !== 'string' ||
    typeof payload.sessionId !== 'string' ||
    typeof payload.participantIdentifier !== 'string' ||
    payload.role !== 'participant'
  ) {
    throw new Error('Invalid participant token payload');
  }
  return {
    sub: payload.sub,
    sessionId: payload.sessionId,
    participantIdentifier: payload.participantIdentifier,
    role: 'participant'
  };
};

export const hashConnectionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
