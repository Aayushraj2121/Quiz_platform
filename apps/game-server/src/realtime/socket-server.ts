import { createHash } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Prisma, PrismaClient, SessionStatus } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { hashConnectionToken, verifyAdminToken, verifyParticipantToken } from '../auth/jwt.js';
import { env } from '../config/env.js';

const sessionPayload = z.object({ sessionId: z.string().cuid() });
const questionStartPayload = sessionPayload.extend({ questionIndex: z.number().int().min(0) });
const answerPayload = sessionPayload.extend({
  questionId: z.string().cuid(),
  optionId: z.string().cuid()
});
const advancePayload = sessionPayload.extend({
  questionIndex: z.number().int().min(0).optional(),
  endGame: z.boolean().default(false)
});

export interface ClientToServerEvents {
  'host:join': (payload: { sessionId: string }, acknowledgement?: Ack) => void;
  'host:start-question': (payload: { sessionId: string; questionIndex: number }, acknowledgement?: Ack) => void;
  'host:reveal-answer': (payload: { sessionId: string }, acknowledgement?: Ack) => void;
  'host:advance-state': (payload: { sessionId: string; questionIndex?: number; endGame?: boolean }, acknowledgement?: Ack) => void;
  'participant:join-game': (payload: { sessionId: string }, acknowledgement?: Ack) => void;
  'participant:submit-answer': (payload: { sessionId: string; questionId: string; optionId: string }, acknowledgement?: Ack) => void;
  'participant:reconnect': (payload: { sessionId: string }, acknowledgement?: Ack) => void;
}

export interface ServerToClientEvents {
  'connection:ready': (payload: { role: 'host' | 'participant'; sessionId?: string }) => void;
  'session:state': (payload: SessionStatePayload) => void;
  'participant:joined': (payload: { displayName: string }) => void;
  'participant:count': (payload: { count: number }) => void;
  'question:started': (payload: SafeQuestionPayload) => void;
  'question:timer': (payload: { questionId: string; deadline: string; remainingMs: number }) => void;
  'question:ended': (payload: { questionId: string; reason: 'timer' | 'manual' }) => void;
  'answer:received': (payload: { participantId: string; questionId: string }) => void;
  'answer:revealed': (payload: { questionId: string; correctOptionId: string }) => void;
  'session:error': (payload: { code: string; message: string }) => void;
}

type Ack = (response: { success: boolean; error?: { code: string; message: string }; data?: unknown }) => void;
type Role = 'host' | 'participant';

interface SocketData {
  role: Role;
  adminId?: string;
  participantId?: string;
  participantIdentifier?: string;
  sessionId?: string;
}

interface SessionStatePayload {
  sessionId: string;
  status: SessionStatus;
  currentQuestionIndex: number;
  deadline: string | null;
}

interface SafeQuestionPayload {
  sessionId: string;
  questionId: string;
  questionIndex: number;
  text: string;
  explanation: string | null;
  timerSeconds: number;
  deadline: string;
  options: Array<{ id: string; text: string }>;
}

type QuizSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const roomFor = (sessionId: string): string => `session:${sessionId}`;
const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

const ackSuccess = (acknowledgement: Ack | undefined, data?: unknown): void => {
  acknowledgement?.({ success: true, data });
};

const ackError = (socket: QuizSocket | undefined, acknowledgement: Ack | undefined, code: string, message: string): void => {
  const error = { code, message };
  acknowledgement?.({ success: false, error });
  socket?.emit('session:error', error);
};

const safeError = (error: unknown): { code: string; message: string } => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return { code: 'ALREADY_ANSWERED', message: 'An answer has already been submitted for this question' };
  }
  return { code: 'INTERNAL_ERROR', message: 'Unable to process the request' };
};

export class RealtimeGameServer {
  public readonly io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
  private readonly timers = new Map<string, { timeout: NodeJS.Timeout; interval: NodeJS.Timeout }>();

  public constructor(private readonly prisma: PrismaClient, httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: { origin: env.CORS_ORIGINS, credentials: true },
      transports: ['websocket', 'polling']
    });
    this.io.use(async (socket, next) => {
      try {
        const auth = z
          .object({ token: z.string().min(1), role: z.enum(['host', 'participant']) })
          .parse(socket.handshake.auth);
        if (auth.role === 'host') {
          const payload = verifyAdminToken(auth.token);
          const admin = await this.prisma.admin.findUnique({ where: { id: payload.sub }, select: { id: true, username: true } });
          if (!admin || admin.username !== payload.username) return next(new Error('UNAUTHORIZED'));
          socket.data = { role: 'host', adminId: admin.id };
        } else {
          const payload = verifyParticipantToken(auth.token);
          const participant = await this.prisma.participant.findUnique({
            where: { id: payload.sub },
            select: { id: true, sessionId: true, participantIdentifier: true, tokenHash: true }
          });
          if (
            !participant ||
            participant.sessionId !== payload.sessionId ||
            participant.participantIdentifier !== payload.participantIdentifier ||
            participant.tokenHash !== hashConnectionToken(auth.token)
          ) {
            return next(new Error('UNAUTHORIZED'));
          }
          socket.data = {
            role: 'participant',
            participantId: participant.id,
            participantIdentifier: participant.participantIdentifier,
            sessionId: participant.sessionId
          };
        }
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });
    this.io.on('connection', (socket) => this.handleConnection(socket));
  }

  public async close(): Promise<void> {
    for (const sessionId of this.timers.keys()) this.clearTimer(sessionId);
    await this.io.close();
  }

  private handleConnection(socket: QuizSocket): void {
    if (socket.data.sessionId) {
      socket.emit('connection:ready', { role: socket.data.role, sessionId: socket.data.sessionId });
    } else {
      socket.emit('connection:ready', { role: socket.data.role });
    }
    socket.on('host:join', (payload, ack) => void this.hostJoin(socket, payload, ack));
    socket.on('host:start-question', (payload, ack) => void this.startQuestion(socket, payload, ack));
    socket.on('host:reveal-answer', (payload, ack) => void this.revealAnswer(socket, payload, ack, 'manual'));
    socket.on('host:advance-state', (payload, ack) => void this.advanceState(socket, payload, ack));
    socket.on('participant:join-game', (payload, ack) => void this.participantJoin(socket, payload, ack));
    socket.on('participant:reconnect', (payload, ack) => void this.participantJoin(socket, payload, ack));
    socket.on('participant:submit-answer', (payload, ack) => void this.submitAnswer(socket, payload, ack));
  }

  private async hostJoin(socket: QuizSocket, payload: { sessionId: string }, ack?: Ack): Promise<void> {
    const parsed = sessionPayload.safeParse(payload);
    if (!parsed.success || socket.data.role !== 'host') return ackError(socket, ack, 'UNAUTHORIZED', 'Host authentication is required');
    const session = await this.prisma.gameSession.findUnique({ where: { id: parsed.data.sessionId }, select: { id: true, status: true, currentQuestionIndex: true, currentQuestionDeadline: true } });
    if (!session) return ackError(socket, ack, 'NOT_FOUND', 'Session not found');
    socket.join(roomFor(session.id));
    socket.data.sessionId = session.id;
    socket.emit('session:state', this.sessionState(session));
    ackSuccess(ack, this.sessionState(session));
  }

  private async participantJoin(socket: QuizSocket, payload: { sessionId: string }, ack?: Ack): Promise<void> {
    const parsed = sessionPayload.safeParse(payload);
    if (!parsed.success || socket.data.role !== 'participant' || socket.data.sessionId !== parsed.data.sessionId) {
      return ackError(socket, ack, 'UNAUTHORIZED', 'Participant is not authorized for this session');
    }
    if (!socket.data.participantId) return ackError(socket, ack, 'UNAUTHORIZED', 'Participant authorization is required');
    const participant = await this.prisma.participant.findUnique({ where: { id: socket.data.participantId }, select: { id: true, displayName: true } });
    const session = await this.prisma.gameSession.findUnique({ where: { id: parsed.data.sessionId }, select: { id: true, status: true, currentQuestionIndex: true, currentQuestionDeadline: true } });
    if (!participant || !session) return ackError(socket, ack, 'NOT_FOUND', 'Session or participant not found');
    socket.join(roomFor(session.id));
    socket.emit('session:state', this.sessionState(session));
    const count = await this.prisma.participant.count({ where: { sessionId: session.id } });
    this.io.to(roomFor(session.id)).emit('participant:joined', { displayName: participant.displayName });
    this.io.to(roomFor(session.id)).emit('participant:count', { count });
    ackSuccess(ack, this.sessionState(session));
  }

  private async startQuestion(socket: QuizSocket, payload: { sessionId: string; questionIndex: number }, ack?: Ack): Promise<void> {
    const parsed = questionStartPayload.safeParse(payload);
    if (!parsed.success || socket.data.role !== 'host' || socket.data.sessionId !== parsed.data.sessionId) {
      return ackError(socket, ack, 'UNAUTHORIZED', 'Host must join the session before starting a question');
    }
    const session = await this.prisma.gameSession.findUnique({ where: { id: parsed.data.sessionId }, select: { id: true, quizId: true, status: true } });
    if (!session) return ackError(socket, ack, 'NOT_FOUND', 'Session not found');
    if (
      session.status !== SessionStatus.LOBBY &&
      session.status !== SessionStatus.REVEAL &&
      session.status !== SessionStatus.LEADERBOARD
    ) {
      return ackError(socket, ack, 'INVALID_STATE', 'Session is not ready to start a question');
    }
    const question = await this.prisma.question.findFirst({
      where: { quizId: session.quizId, order: parsed.data.questionIndex + 1 },
      include: { options: { select: { id: true, text: true } } }
    });
    if (!question) return ackError(socket, ack, 'NOT_FOUND', 'Question not found');
    const deadline = new Date(Date.now() + question.timerSeconds * 1000);
    const updated = await this.prisma.gameSession.update({
      where: { id: session.id },
      data: { status: SessionStatus.QUESTION, currentQuestionIndex: parsed.data.questionIndex, currentQuestionDeadline: deadline, startTime: new Date() },
      select: { id: true, status: true, currentQuestionIndex: true, currentQuestionDeadline: true }
    });
    this.clearTimer(session.id);
    this.startTimer(session.id, question.id, deadline);
    const safeQuestion: SafeQuestionPayload = {
      sessionId: session.id,
      questionId: question.id,
      questionIndex: parsed.data.questionIndex,
      text: question.text,
      explanation: question.explanation,
      timerSeconds: question.timerSeconds,
      deadline: deadline.toISOString(),
      options: question.options
    };
    this.io.to(roomFor(session.id)).emit('question:started', safeQuestion);
    this.io.to(roomFor(session.id)).emit('session:state', this.sessionState(updated));
    ackSuccess(ack, safeQuestion);
  }

  private async revealAnswer(socket: QuizSocket, payload: { sessionId: string }, ack?: Ack, reason: 'timer' | 'manual' = 'manual'): Promise<void> {
    const parsed = sessionPayload.safeParse(payload);
    if (!parsed.success || socket.data.role !== 'host' || socket.data.sessionId !== parsed.data.sessionId) {
      return ackError(socket, ack, 'UNAUTHORIZED', 'Host authorization is required');
    }
    await this.revealSession(parsed.data.sessionId, reason, socket, ack);
  }

  private async revealSession(sessionId: string, reason: 'timer' | 'manual', socket?: QuizSocket, ack?: Ack): Promise<void> {
    const session = await this.prisma.gameSession.findUnique({ where: { id: sessionId }, select: { id: true, status: true, currentQuestionIndex: true, quizId: true } });
    if (!session) return ackError(socket ?? this.io.sockets.sockets.values().next().value, ack, 'NOT_FOUND', 'Session not found');
    if (session.status !== SessionStatus.QUESTION) {
      if (session.status === SessionStatus.REVEAL) return ackSuccess(ack);
      return ackError(socket ?? this.io.sockets.sockets.values().next().value, ack, 'INVALID_STATE', 'Question is not active');
    }
    const question = await this.prisma.question.findFirst({ where: { quizId: session.quizId, order: session.currentQuestionIndex + 1 }, select: { id: true, options: { where: { isCorrect: true }, select: { id: true } } } });
    if (!question || question.options.length !== 1) return ackError(socket ?? this.io.sockets.sockets.values().next().value, ack, 'INVALID_QUESTION', 'Question answer is unavailable');
    this.clearTimer(sessionId);
    const updated = await this.prisma.gameSession.update({ where: { id: sessionId }, data: { status: SessionStatus.REVEAL, currentQuestionDeadline: null }, select: { id: true, status: true, currentQuestionIndex: true, currentQuestionDeadline: true } });
    this.io.to(roomFor(sessionId)).emit('question:ended', { questionId: question.id, reason });
    const correctOption = question.options[0];
    if (!correctOption) return ackError(socket, ack, 'INVALID_QUESTION', 'Question answer is unavailable');
    this.io.to(roomFor(sessionId)).emit('answer:revealed', { questionId: question.id, correctOptionId: correctOption.id });
    this.io.to(roomFor(sessionId)).emit('session:state', this.sessionState(updated));
    ackSuccess(ack);
  }

  private async advanceState(socket: QuizSocket, payload: { sessionId: string; questionIndex?: number; endGame?: boolean }, ack?: Ack): Promise<void> {
    const parsed = advancePayload.safeParse(payload);
    if (!parsed.success || socket.data.role !== 'host' || socket.data.sessionId !== parsed.data.sessionId) {
      return ackError(socket, ack, 'UNAUTHORIZED', 'Host authorization is required');
    }
    const session = await this.prisma.gameSession.findUnique({ where: { id: parsed.data.sessionId }, select: { id: true, status: true } });
    if (!session) return ackError(socket, ack, 'NOT_FOUND', 'Session not found');
    if (parsed.data.endGame) {
      this.clearTimer(session.id);
      const ended = await this.prisma.gameSession.update({ where: { id: session.id }, data: { status: SessionStatus.ENDED, endTime: new Date(), currentQuestionDeadline: null }, select: { id: true, status: true, currentQuestionIndex: true, currentQuestionDeadline: true } });
      this.io.to(roomFor(session.id)).emit('session:state', this.sessionState(ended));
      return ackSuccess(ack, this.sessionState(ended));
    }
    if (
      (session.status !== SessionStatus.REVEAL && session.status !== SessionStatus.LEADERBOARD) ||
      parsed.data.questionIndex === undefined
    ) {
      return ackError(socket, ack, 'INVALID_STATE', 'Session cannot advance to the requested question');
    }
    await this.startQuestion(socket, { sessionId: session.id, questionIndex: parsed.data.questionIndex }, ack);
  }

  private async submitAnswer(socket: QuizSocket, payload: { sessionId: string; questionId: string; optionId: string }, ack?: Ack): Promise<void> {
    const parsed = answerPayload.safeParse(payload);
    if (!parsed.success || socket.data.role !== 'participant' || socket.data.sessionId !== parsed.data.sessionId || !socket.data.participantId) {
      return ackError(socket, ack, 'UNAUTHORIZED', 'Participant authorization is required');
    }
    const session = await this.prisma.gameSession.findUnique({ where: { id: parsed.data.sessionId }, select: { id: true, status: true, currentQuestionIndex: true, currentQuestionDeadline: true, quizId: true } });
    if (!session || session.status !== SessionStatus.QUESTION || !session.currentQuestionDeadline || session.currentQuestionDeadline.getTime() <= Date.now()) {
      return ackError(socket, ack, 'TOO_LATE', 'The question is no longer accepting answers');
    }
    const question = await this.prisma.question.findFirst({ where: { quizId: session.quizId, id: parsed.data.questionId, order: session.currentQuestionIndex + 1 }, select: { id: true } });
    const option = await this.prisma.questionOption.findFirst({
      where: { id: parsed.data.optionId, questionId: parsed.data.questionId },
      select: { id: true, isCorrect: true }
    });
    if (!question || !option) return ackError(socket, ack, 'INVALID_OPTION', 'The option does not belong to the active question');
    try {
      await this.prisma.answer.create({
        data: {
          participantId: socket.data.participantId,
          questionId: question.id,
          selectedOptionId: option.id,
          isCorrect: option.isCorrect,
          awardedPoints: 0,
          responseTimeMs: Math.max(0, session.currentQuestionDeadline.getTime() - Date.now())
        }
      });
    } catch (error) {
      const safe = safeError(error);
      return ackError(socket, ack, safe.code, safe.message);
    }
    for (const connectedSocket of this.io.sockets.sockets.values()) {
      if (connectedSocket.data.role === 'host' && connectedSocket.data.sessionId === session.id) {
        connectedSocket.emit('answer:received', { participantId: socket.data.participantId, questionId: question.id });
      }
    }
    ackSuccess(ack, { questionId: question.id, acceptedAt: new Date().toISOString() });
  }

  private startTimer(sessionId: string, questionId: string, deadline: Date): void {
    const interval = setInterval(() => {
      const remainingMs = Math.max(0, deadline.getTime() - Date.now());
      this.io.to(roomFor(sessionId)).emit('question:timer', { questionId, deadline: deadline.toISOString(), remainingMs });
    }, 1_000);
    const timeout = setTimeout(() => void this.revealSession(sessionId, 'timer'), Math.max(0, deadline.getTime() - Date.now()));
    this.timers.set(sessionId, { timeout, interval });
  }

  private clearTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer.timeout);
    clearInterval(timer.interval);
    this.timers.delete(sessionId);
  }

  private sessionState(session: { id: string; status: SessionStatus; currentQuestionIndex: number; currentQuestionDeadline: Date | null }): SessionStatePayload {
    return { sessionId: session.id, status: session.status, currentQuestionIndex: session.currentQuestionIndex, deadline: session.currentQuestionDeadline?.toISOString() ?? null };
  }
}
