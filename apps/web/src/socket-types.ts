import type { LeaderboardEntry, SafeQuestion, SessionState, RevealPayload, PersonalReveal } from './types';

export interface ClientToServerEvents {
  'host:join': (payload: { sessionId: string }, ack?: Ack) => void;
  'host:start-question': (payload: { sessionId: string; questionIndex: number }, ack?: Ack) => void;
  'host:reveal': (payload: { sessionId: string }, ack?: Ack) => void;
  'host:extend': (payload: { sessionId: string; seconds: 10 }, ack?: Ack) => void;
  'host:leaderboard': (payload: { sessionId: string }, ack?: Ack) => void;
  'host:end': (payload: { sessionId: string }, ack?: Ack) => void;
  'participant:join-game': (payload: { sessionId: string }, ack?: Ack) => void;
  'participant:reconnect': (payload: { sessionId: string }, ack?: Ack) => void;
  'participant:submit-answer': (payload: { sessionId: string; questionId: string; optionId: string }, ack?: Ack) => void;
  'leaderboard:request': (payload: { sessionId: string }, ack?: Ack) => void;
}

export interface ServerToClientEvents {
  'connection:ready': (payload: { role: 'host' | 'participant'; sessionId?: string }) => void;
  'session:state': (payload: SessionState) => void;
  'participant:joined': (payload: { displayName: string }) => void;
  'participant:count': (payload: { count: number }) => void;
  'question:started': (payload: SafeQuestion) => void;
  'question:start': (payload: SafeQuestion) => void;
  'question:progress': (payload: { answered: number; total: number }) => void;
  'question:timer': (payload: { questionId: string; deadline: string; remainingMs: number }) => void;
  'question:ended': (payload: { questionId: string; reason: 'timer' | 'manual' }) => void;
  'answer:received': (payload: { participantId: string; questionId: string }) => void;
  'answer:revealed': (payload: { questionId: string; correctOptionId: string }) => void;
  reveal: (payload: RevealPayload) => void;
  'reveal:personal': (payload: PersonalReveal) => void;
  leaderboard: (payload: { entries: LeaderboardEntry[] }) => void;
  'leaderboard:updated': (payload: { sessionId: string; entries: LeaderboardEntry[] }) => void;
  podium: (payload: { entries: LeaderboardEntry[]; participantCount: number }) => void;
  'game:ended': () => void;
  'session:error': (payload: { code: string; message: string }) => void;
}

export type Ack = (response: { success: boolean; data?: unknown; error?: { code: string; message: string } }) => void;
