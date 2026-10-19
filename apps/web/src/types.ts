export type SessionStatus = 'LOBBY' | 'QUESTION' | 'REVEAL' | 'LEADERBOARD' | 'PODIUM' | 'ENDED';

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

export interface Participant {
  id: string;
  participantIdentifier: string;
  displayName: string;
  joinedAt?: string;
  totalScore?: number;
  correctCount?: number;
}

export interface JoinResponse {
  participant: Participant;
  connectionToken: string;
  joinUrl?: string;
  session: { id: string; pin: string; status: SessionStatus; quiz: { title: string } };
}

export interface SessionState {
  sessionId: string;
  status: SessionStatus;
  currentQuestionIndex: number;
  deadline: string | null;
}

export interface SafeQuestion {
  sessionId: string;
  questionId: string;
  questionIndex: number;
  text: string;
  explanation: string | null;
  timerSeconds: number;
  deadline: string;
  mediaAssetId: string | null;
  options: Array<{ id: string; text: string }>;
}

export interface LeaderboardEntry {
  rank: number;
  participantIdentifier: string;
  displayName: string;
  totalScore: number;
  correctCount: number;
}

export interface RevealPayload {
  questionId: string;
  correctOptionId: string;
  distribution: Array<{ optionId: string; count: number }>;
  explanation: string | null;
}

export interface PersonalReveal {
  questionId: string;
  correct: boolean;
  points: number;
  streak: number;
  totalScore: number;
}

export interface SessionResults {
  session: { id: string; pin: string; status: SessionStatus; quiz: { id: string; title: string } };
  leaderboard: LeaderboardEntry[];
  podium: LeaderboardEntry[];
  questionStats: Array<{ questionId: string; order: number; text: string; answerCount: number; correctCount: number; awardedPoints: number }>;
  participants: Array<Participant & { answers?: unknown[] }>;
}

export type QuizStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface QuizSummary {
  id: string;
  title: string;
  description: string | null;
  status: QuizStatus;
  createdAt: string;
  updatedAt: string;
  _count: { questions: number; sessions: number };
}

export interface QuizQuestion {
  id: string;
  order: number;
  text: string;
  explanation: string | null;
  timerSeconds: number;
  basePoints: number;
  mediaAssetId: string | null;
  options: Array<{ id: string; text: string; isCorrect: boolean }>;
  mediaAsset?: { id: string; mimeType: string; originalName: string; sizeBytes: number } | null;
}

export interface QuizDetail extends QuizSummary {
  questions: QuizQuestion[];
}

export interface AdminSession {
  id: string;
  quizId: string;
  pin: string;
  status: SessionStatus;
  currentQuestionIndex: number;
  createdAt: string;
  quiz: { id: string; title: string; description: string | null; status: QuizStatus };
  _count: { participants: number };
}
