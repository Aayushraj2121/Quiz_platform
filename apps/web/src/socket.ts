import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from './socket-types';

const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;

export const createQuizSocket = (token: string, role: 'host' | 'participant') =>
  io(socketUrl, {
    auth: { token, role },
    transports: ['websocket', 'polling'],
    autoConnect: false,
    path: '/socket.io'
  }) as QuizSocket;

export type QuizSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
