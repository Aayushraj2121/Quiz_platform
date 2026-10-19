import type { AdminSession, ApiEnvelope, JoinResponse, QuizDetail, QuizQuestion, QuizStatus, QuizSummary, SessionResults } from './types';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:4000/api';

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  });
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.success) throw new Error(body.error?.message ?? 'Request failed');
  return body.data;
};

export const joinSession = (pin: string, displayName: string) =>
  request<JoinResponse>(`/sessions/join/${encodeURIComponent(pin)}`, {
    method: 'POST',
    body: JSON.stringify({ displayName })
  });

export const getParticipantResults = (sessionId: string, token: string) =>
  request<SessionResults>(`/results/${sessionId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

export const loginAdmin = (username: string, password: string) =>
  request<{ token: string; admin: { id: string; username: string } }>('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });

export const listSessions = (token: string) =>
  request<{ items: Array<{ id: string; pin: string; status: string; quiz?: { title: string }; currentQuestionIndex: number }>; total: number }>(
    '/sessions?page=1&pageSize=50',
    { headers: { Authorization: `Bearer ${token}` } }
  );

const auth = (token: string): HeadersInit => ({ Authorization: `Bearer ${token}` });

export const listQuizzes = (token: string) =>
  request<{ items: QuizSummary[]; total: number }>('/quizzes?page=1&pageSize=100', { headers: auth(token) });

export const createQuiz = (token: string, data: { title: string; description?: string; status?: QuizStatus }) =>
  request<QuizSummary>('/quizzes', { method: 'POST', headers: auth(token), body: JSON.stringify(data) });

export const updateQuiz = (token: string, id: string, data: { title?: string; description?: string | null; status?: QuizStatus }) =>
  request<QuizSummary>(`/quizzes/${id}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(data) });

export const getQuiz = (token: string, id: string) =>
  request<QuizDetail>(`/quizzes/${id}`, { headers: auth(token) });

export const createQuestion = (token: string, quizId: string, data: {
  order: number; text: string; explanation?: string; timerSeconds: number; basePoints: number;
  options: Array<{ text: string; isCorrect: boolean }>;
}) => request<QuizQuestion>(`/questions/quiz/${quizId}`, {
  method: 'POST', headers: auth(token), body: JSON.stringify(data)
});

export const deleteQuestion = (token: string, questionId: string) =>
  request<unknown>(`/questions/${questionId}`, { method: 'DELETE', headers: auth(token) });

export const createSession = (token: string, quizId: string) =>
  request<AdminSession>('/sessions', { method: 'POST', headers: auth(token), body: JSON.stringify({ quizId }) });

export const deleteSession = (token: string, sessionId: string) =>
  request<{ id: string; deleted: boolean }>(`/sessions/${sessionId}`, { method: 'DELETE', headers: auth(token) });

export const getSessionResults = (token: string, sessionId: string) =>
  request<SessionResults>(`/results/${sessionId}`, { headers: auth(token) });

export const uploadMedia = async (token: string, questionId: string, file: File) => {
  const response = await fetch(`${apiUrl}/media/questions/${questionId}`, {
    method: 'POST',
    headers: auth(token),
    body: (() => {
      const form = new FormData();
      form.append('file', file);
      return form;
    })()
  });
  const body = (await response.json()) as ApiEnvelope<{ id: string; originalName: string; mimeType: string; sizeBytes: number }>;
  if (!response.ok || !body.success) throw new Error(body.error?.message ?? 'Upload failed');
  return body.data;
};

export const verifyCertificate = (code: string) =>
  request<{ verificationCode: string; participantName: string; event: string; issuedAt: string }>(`/cert/verify/${encodeURIComponent(code)}`);

export const getCertificate = (participantToken: string) =>
  request<{ verificationCode: string; participantName: string; event: string; issuedAt: string }>(`/cert/${encodeURIComponent(participantToken)}`);
