import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from './socket-types';

const socketUrl = import.meta.env.VITE_SOCKET_URL ?? 'http://127.0.0.1:4000';

export const createQuizSocket = (token: string, role: 'host' | 'participant') =>
  io(socketUrl, {
    auth: { token, role },
    transports: ['websocket', 'polling'],
    autoConnect: false
  }) as QuizSocket;

export type QuizSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
