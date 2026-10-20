import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  createQuestion, createQuiz, createSession, deleteQuestion, deleteQuiz, deleteSession, getQuiz, getSessionResults, listQuizzes,
  listSessions, loginAdmin, updateQuiz, uploadMedia, verifyCertificate
} from './api';
import { createQuizSocket, type QuizSocket } from './socket';
import type { AdminSession, QuizDetail, QuizQuestion, QuizStatus, QuizSummary, SessionResults } from './types';

type AdminTab = 'overview' | 'quizzes' | 'sessions' | 'host' | 'results' | 'verify';

const blankQuestion = () => ({
  order: 1,
  text: '',
  explanation: '',
  timerSeconds: 30,
  basePoints: 1000,
  options: [
    { text: '', isCorrect: true },
    { text: '', isCorrect: false }
  ]
});

export function AdminConsole({ onBack }: { onBack: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [tab, setTab] = useState<AdminTab>('overview');
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState<QuizDetail | null>(null);
  const [selectedSession, setSelectedSession] = useState<AdminSession | null>(null);
  const [results, setResults] = useState<SessionResults | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async (authToken = token) => {
    const [quizData, sessionData] = await Promise.all([listQuizzes(authToken), listSessions(authToken)]);
    setQuizzes(quizData.items);
    setSessions(sessionData.items as AdminSession[]);
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const data = await loginAdmin(username, password);
      setToken(data.token);
      await refresh(data.token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in');
    }
  };

  if (!token) {
    return (
      <main className="app-shell landing-shell">
        <div style={{ padding: '20px 32px', borderBottom: '1px solid var(--border)' }}>
          <button className="back-button" onClick={onBack}>← Back to quiz join</button>
        </div>
        <section className="host-panel">
          <p className="eyebrow">Admin Access</p>
          <h2>Control Room</h2>
          <form className="join-card" onSubmit={login}>
            <label>Admin username<input value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            {error && <p className="error-text">{error}</p>}
            <button>Sign in to Control Room</button>
          </form>
        </section>
      </main>
    );
  }

  const openQuiz = async (id: string) => {
    if (!id) {
      setSelectedQuiz(null);
      return;
    }
    try {
      setSelectedQuiz(await getQuiz(token, id));
      setTab('quizzes');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load quiz'); }
  };

  const loadResults = async (session: AdminSession) => {
    try {
      setSelectedSession(session);
      setResults(await getSessionResults(token, session.id));
      setTab('results');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load results'); }
  };

  const openHost = (session: AdminSession) => {
    setSelectedSession(session);
    setTab('host');
  };

  return (
    <main className="app-shell admin-shell">
      <header className="topbar admin-topbar">
        <button className="brand-mark brand-button" onClick={() => setTab('overview')} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/club-logo.png" alt="" width={28} height={28} style={{ borderRadius: 4 }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          <span>CTPDF · Quiz Admin</span>
        </button>
        <nav className="admin-nav">{(['overview', 'quizzes', 'sessions', 'host', 'results', 'verify'] as AdminTab[]).map((item) => <button className={tab === item ? 'active' : ''} onClick={() => setTab(item)} key={item}>{item}</button>)}</nav>
        <button className="text-button" onClick={onBack}>Exit</button>
      </header>
      <section className="admin-content">
        {error && <p className="error-text floating-error">{error}<button className="dismiss" onClick={() => setError('')}>×</button></p>}
        {notice && <p className="notice-text">{notice}</p>}
        {tab === 'overview' && <Overview quizzes={quizzes} sessions={sessions} onQuizzes={() => setTab('quizzes')} onSessions={() => setTab('sessions')} />}
        {tab === 'quizzes' && <QuizWorkspace token={token} quizzes={quizzes} selectedQuiz={selectedQuiz} onSelect={openQuiz} onCreated={async () => { await refresh(); setNotice('Quiz created'); }} onUpdated={async () => { await refresh(); if (selectedQuiz) await openQuiz(selectedQuiz.id); }} onError={setError} />}
        {tab === 'sessions' && <SessionWorkspace token={token} sessions={sessions} quizzes={quizzes} onChanged={async (msg) => { await refresh(); setNotice(msg ?? 'Sessions updated'); }} onResults={loadResults} onHost={openHost} onError={setError} />}
        {tab === 'host' && <HostControl token={token} session={selectedSession} onError={setError} />}
        {tab === 'results' && <ResultsWorkspace token={token} session={selectedSession} results={results} />}
        {tab === 'verify' && <CertificateVerifier onError={setError} />}
      </section>
    </main>
  );
}

function Overview({ quizzes, sessions, onQuizzes, onSessions }: { quizzes: QuizSummary[]; sessions: AdminSession[]; onQuizzes: () => void; onSessions: () => void }) {
  const published = quizzes.filter((quiz) => quiz.status === 'PUBLISHED').length;
  const live = sessions.filter((session) => !['ENDED', 'PODIUM'].includes(session.status)).length;
  return <div className="admin-page"><p className="eyebrow">Overview</p><h1 className="admin-title">Quiz Platform Dashboard</h1><div className="metric-grid"><button onClick={onQuizzes}><span>QUIZZES</span><strong>{quizzes.length}</strong><small>{published} published</small></button><button onClick={onSessions}><span>SESSIONS</span><strong>{sessions.length}</strong><small>{live} active</small></button><div><span>PLATFORM</span><strong>READY</strong><small>Live quiz engine online</small></div></div><div className="admin-callout"><span>GETTING STARTED</span><p>Build and publish a quiz, create a session, then host it live. Participants join from the public quiz screen using the session PIN or QR code.</p></div></div>;
}

function QuizWorkspace({ token, quizzes, selectedQuiz, onSelect, onCreated, onUpdated, onError }: { token: string; quizzes: QuizSummary[]; selectedQuiz: QuizDetail | null; onSelect: (id: string) => void; onCreated: () => void; onUpdated: () => void; onError: (message: string) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [question, setQuestion] = useState(blankQuestion());
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await createQuiz(token, { title, description });
      setTitle(''); setDescription(''); onCreated();
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Unable to create quiz'); }
  };
  const addQuestion = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedQuiz) return;
    if (question.options.filter((item) => item.text.trim()).length < 2 || question.options.filter((item) => item.isCorrect).length !== 1) {
      onError('Add at least two options and exactly one correct answer'); return;
    }
    setSaving(true);
    try {
      const created = await createQuestion(token, selectedQuiz.id, question);
      if (file) await uploadMedia(token, created.id, file);
      setQuestion({ ...blankQuestion(), order: created.order + 1 }); setFile(null); onUpdated();
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Unable to add question'); } finally { setSaving(false); }
  };
  const publish = async (status: QuizStatus) => {
    if (!selectedQuiz) return;
    try { await updateQuiz(token, selectedQuiz.id, { status }); onUpdated(); } catch (cause) { onError(cause instanceof Error ? cause.message : 'Unable to update quiz'); }
  };
  const removeQuiz = async () => {
    if (!selectedQuiz) return;
    const confirmed = window.confirm(`Are you sure you want to delete "${selectedQuiz.title}" and all its questions? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await deleteQuiz(token, selectedQuiz.id);
      onSelect('');
      onUpdated();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Unable to delete quiz');
    }
  };
  const addOption = () => {
    if (question.options.length >= 4) return;
    setQuestion({ ...question, options: [...question.options, { text: '', isCorrect: false }] });
  };
  const removeOption = (index: number) => {
    if (question.options.length <= 2) return;
    const next = question.options.filter((_, i) => i !== index);
    // if we just removed the correct option, mark first as correct
    const hasCorrect = next.some((o) => o.isCorrect);
    setQuestion({ ...question, options: hasCorrect ? next : next.map((o, i) => ({ ...o, isCorrect: i === 0 })) });
  };
  const updateOption = (index: number, text: string) =>
    setQuestion({ ...question, options: question.options.map((item, i) => i === index ? { ...item, text } : item) });
  const setCorrect = (index: number) =>
    setQuestion({ ...question, options: question.options.map((item, i) => ({ ...item, isCorrect: i === index })) });

  return (
    <div className="admin-page">
      <p className="eyebrow">CONTENT STUDIO</p>
      <h1 className="admin-title">Quizzes & question bank</h1>
      <div className="split-workspace">
        <aside className="list-panel">
          <button className="create-tile" onClick={() => onSelect('')}>+ New quiz</button>
          {quizzes.map((quiz) => (
            <button className={`list-item ${selectedQuiz?.id === quiz.id ? 'selected' : ''}`} onClick={() => onSelect(quiz.id)} key={quiz.id}>
              <span>{quiz.title}</span>
              <small>{quiz.status} · {quiz._count.questions} questions</small>
            </button>
          ))}
        </aside>
        <section className="editor-panel">
          {!selectedQuiz ? (
            <form className="editor-card" onSubmit={create}>
              <p className="eyebrow">NEW QUIZ</p>
              <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Digital Safety Under Pressure" required /></label>
              <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="What should participants investigate?" /></label>
              <button>Create quiz</button>
            </form>
          ) : (
            <>
              <div className="editor-heading">
                <div><p className="eyebrow">{selectedQuiz.status}</p><h2>{selectedQuiz.title}</h2></div>
                <div className="button-row">
                  <button onClick={() => publish(selectedQuiz.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED')}>
                    {selectedQuiz.status === 'PUBLISHED' ? 'Unpublish' : 'Publish quiz'}
                  </button>
                  <button className="ghost-danger" type="button" onClick={removeQuiz}>
                    Delete quiz
                  </button>
                </div>
              </div>
              <div className="question-list">
                {selectedQuiz.questions.map((item) => <QuestionCard key={item.id} question={item} token={token} onDeleted={onUpdated} onError={onError} />)}
              </div>
              <form className="editor-card question-form" onSubmit={addQuestion}>
                <p className="eyebrow">ADD QUESTION {question.order}</p>
                <label>Question
                  <textarea value={question.text} onChange={(event) => setQuestion({ ...question, text: event.target.value })} rows={3} required />
                </label>
                <div className="field-row">
                  <label>Timer seconds
                    <input type="number" min={10} max={120} value={question.timerSeconds} onChange={(event) => setQuestion({ ...question, timerSeconds: Number(event.target.value) })} />
                  </label>
                  <label>Base points
                    <input type="number" min={1} value={question.basePoints} onChange={(event) => setQuestion({ ...question, basePoints: Number(event.target.value) })} />
                  </label>
                </div>
                <label>Explanation
                  <textarea value={question.explanation} onChange={(event) => setQuestion({ ...question, explanation: event.target.value })} rows={2} />
                </label>
                <div className="option-editor">
                  <div className="option-editor-header">
                    <span>Answer options <small style={{ opacity: 0.55 }}>({question.options.length}/4 · min 2)</small></span>
                    {question.options.length < 4 && (
                      <button type="button" className="btn-add-option" onClick={addOption}>+ Add option</button>
                    )}
                  </div>
                  {question.options.map((option, index) => (
                    <div className="option-line" key={index}>
                      <span className="option-index">{index + 1}</span>
                      <input
                        value={option.text}
                        onChange={(event) => updateOption(index, event.target.value)}
                        placeholder={`Option ${index + 1}`}
                      />
                      <label className="check-label" title="Mark as correct answer">
                        <input type="radio" checked={option.isCorrect} onChange={() => setCorrect(index)} />
                        Correct
                      </label>
                      {question.options.length > 2 && (
                        <button
                          type="button"
                          className="btn-remove-option"
                          onClick={() => removeOption(index)}
                          title="Remove this option"
                        >×</button>
                      )}
                    </div>
                  ))}
                </div>
                <label>Media image/video
                  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                </label>
                <button disabled={saving}>{saving ? 'Saving…' : 'Add question'}</button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function QuestionCard({ question, token, onDeleted, onError }: { question: QuizQuestion; token: string; onDeleted: () => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const apiBase = (import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:4000/api').replace(/\/+$/, '');
  const mediaUrl = question.mediaAssetId ? `${apiBase}/media/${question.mediaAssetId}` : null;

  const remove = async () => {
    if (!window.confirm(`Delete question Q${question.order}?`)) return;
    setBusy(true);
    try {
      await deleteQuestion(token, question.id);
      onDeleted();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Unable to delete question');
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await uploadMedia(token, question.id, file);
      onDeleted();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Failed to upload media');
    } finally {
      setUploading(false);
    }
  };

  return (
    <article className="question-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="question-number">Q{String(question.order).padStart(2, '0')}</span>
        <h3>{question.text}</h3>
        <p>{question.timerSeconds}s · {question.basePoints.toLocaleString()} points · {question.options.length} options</p>
        {mediaUrl && (
          <div style={{ marginTop: 8 }}>
            <img
              src={mediaUrl}
              alt="Question media preview"
              style={{ maxHeight: 90, maxWidth: 160, borderRadius: 6, objectFit: 'contain', border: '1px solid var(--border, #334155)', background: '#0b1329' }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.opacity = '0.4';
                (e.currentTarget as HTMLImageElement).title = 'Image failed to load';
              }}
            />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
        <label style={{ cursor: 'pointer', fontSize: 12, padding: '5px 10px', background: 'var(--card-bg, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 4, color: 'var(--text-main, #e2e8f0)', display: 'inline-block' }}>
          {uploading ? 'Uploading…' : mediaUrl ? 'Replace image' : '+ Add image'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm"
            style={{ display: 'none' }}
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
            }}
          />
        </label>
        <button className="ghost-danger" onClick={remove} disabled={busy}>
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </article>
  );
}

function SessionWorkspace({ token, sessions, quizzes, onChanged, onResults, onHost, onError }: { token: string; sessions: AdminSession[]; quizzes: QuizSummary[]; onChanged: (msg?: string) => void; onResults: (session: AdminSession) => void; onHost: (session: AdminSession) => void; onError: (message: string) => void }) {
  const published = quizzes.filter((quiz) => quiz.status === 'PUBLISHED');
  const [quizId, setQuizId] = useState(published[0]?.id ?? '');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const create = async () => {
    try {
      await createSession(token, quizId);
      onChanged('Session created');
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Unable to create session');
    }
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const removeSession = async (sessionId: string) => {
    setDeletingId(sessionId);
    try {
      await deleteSession(token, sessionId);
      setConfirmDeleteId(null);
      onChanged('Session deleted successfully');
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Unable to delete session');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="admin-page">
      <p className="eyebrow">LIVE OPERATIONS</p>
      <h1 className="admin-title">Launch a session.</h1>
      <div className="launch-bar">
        <select value={quizId} onChange={(event) => setQuizId(event.target.value)}>
          <option value="">Select published quiz</option>
          {published.map((quiz) => (
            <option key={quiz.id} value={quiz.id}>{quiz.title}</option>
          ))}
        </select>
        <button onClick={create} disabled={!quizId}>Create lobby</button>
      </div>
      <div className="session-table">
        {sessions.map((session) => (
          <div className="session-card" key={session.id}>
            <div>
              <span className="eyebrow">{session.status}</span>
              <h3>{session.quiz.title}</h3>
              <p>{session._count.participants} participants · {new Date(session.createdAt).toLocaleString()}</p>
            </div>
            <JoinQr pin={session.pin} compact />
            <div className="session-pin">{session.pin}</div>
            <div className="session-actions">
              <button onClick={() => onHost(session)}>Host</button>
              <button onClick={() => onResults(session)}>Results</button>
              {confirmDeleteId === session.id ? (
                <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <button
                    className="danger-button"
                    style={{ padding: '8px 12px', fontSize: 11 }}
                    onClick={() => removeSession(session.id)}
                    disabled={deletingId === session.id}
                  >
                    {deletingId === session.id ? 'Deleting…' : 'Confirm?'}
                  </button>
                  <button
                    className="btn-outline"
                    style={{ padding: '8px 10px', fontSize: 11 }}
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="ghost-danger"
                  style={{ padding: '8px 12px' }}
                  onClick={() => setConfirmDeleteId(session.id)}
                  title="Delete session"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function JoinQr({ pin, compact = false }: { pin: string; compact?: boolean }) {
  const joinUrl = `${window.location.origin}/?pin=${encodeURIComponent(pin)}`;
  return <div className={`join-qr ${compact ? 'compact' : ''}`} title={`Scan to join game ${pin}`}><QRCodeSVG value={joinUrl} size={compact ? 72 : 180} bgColor="#ffffff" fgColor="#08111f" includeMargin /><span>SCAN TO JOIN</span></div>;
}

function HostControl({ token, session, onError }: { token: string; session: AdminSession | null; onError: (message: string) => void }) {
  const [status, setStatus] = useState(session?.status ?? 'LOBBY');
  const [questionIndex, setQuestionIndex] = useState(Math.max(0, session?.currentQuestionIndex ?? 0));
  const [socket, setSocket] = useState<QuizSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [answerCount, setAnswerCount] = useState({ answered: 0, total: 0 });

  useEffect(() => {
    if (!session) return;
    const next = createQuizSocket(token, 'host');
    next.on('connect', () => setConnected(true));
    next.on('disconnect', () => setConnected(false));
    next.on('session:state', (state) => {
      setStatus(state.status);
      setQuestionIndex(Math.max(0, state.currentQuestionIndex));
    });
    next.on('question:progress', setAnswerCount);
    next.on('session:error', (event) => onError(event.message));
    next.on('connect_error', () => onError('Host connection was rejected'));
    next.connect();
    next.emit('host:join', { sessionId: session.id }, (response) => {
      if (!response.success) onError(response.error?.message ?? 'Unable to join session');
    });
    setSocket(next);
    return () => { next.removeAllListeners(); next.disconnect(); setSocket(null); };
  }, [onError, session, token]);

  if (!session) return <div className="admin-page"><p className="eyebrow">HOST CONTROL</p><h1 className="admin-title">Select a session first.</h1></div>;
  const emit = (event: 'host:start-question' | 'host:reveal' | 'host:extend' | 'host:leaderboard' | 'host:end') => {
    if (!socket) return;
    if (event === 'host:start-question') {
      socket.emit(event, { sessionId: session.id, questionIndex }, (response) => { if (!response.success) onError(response.error?.message ?? 'Command failed'); });
    } else if (event === 'host:extend') {
      socket.emit(event, { sessionId: session.id, seconds: 10 }, (response) => { if (!response.success) onError(response.error?.message ?? 'Command failed'); });
    } else {
      socket.emit(event, { sessionId: session.id }, (response) => { if (!response.success) onError(response.error?.message ?? 'Command failed'); });
    }
  };
  return <div className="admin-page"><p className="eyebrow">HOST CONTROL · PIN {session.pin}</p><h1 className="admin-title">{session.quiz.title}</h1><div className="host-layout"><div><div className="host-status-card"><div><span>CONNECTION</span><strong className={connected ? 'connected' : ''}>{connected ? 'CONNECTED' : 'CONNECTING'}</strong></div><div><span>STATE</span><strong>{status}</strong></div><div><span>ANSWERS</span><strong>{answerCount.answered}/{answerCount.total || '—'}</strong></div></div><div className="host-controls admin-host-controls"><label>Question index<input type="number" min={0} value={questionIndex} onChange={(event) => setQuestionIndex(Number(event.target.value))} /></label><button onClick={() => emit('host:start-question')}>Start / advance</button><button onClick={() => emit('host:reveal')} disabled={status !== 'QUESTION'}>Reveal answer</button><button onClick={() => emit('host:extend')} disabled={status !== 'QUESTION'}>+10 seconds</button><button onClick={() => emit('host:leaderboard')} disabled={status !== 'REVEAL'}>Show leaderboard</button><button className="danger-button" onClick={() => emit('host:end')}>End game</button></div></div><JoinQr pin={session.pin} /></div><p className="muted">Participants can scan the QR code or join with PIN <b>{session.pin}</b>. The live client receives question, reveal, leaderboard, podium, and game-ended events automatically.</p></div>;
}

function ResultsWorkspace({ token, session, results }: { token: string; session: AdminSession | null; results: SessionResults | null }) {
  if (!session || !results) return <div className="admin-page"><p className="eyebrow">RESULTS</p><h1 className="admin-title">Select a session to inspect results.</h1></div>;
  const apiUrl = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:4000/api';
  const download = async (detail: boolean) => {
    const response = await fetch(`${apiUrl}/results/${session.id}/export${detail ? '?detail=1' : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `session-${session.id}-${detail ? 'detail' : 'summary'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <div className="admin-page"><p className="eyebrow">SESSION RESULTS · {session.pin}</p><h1 className="admin-title">{session.quiz.title}</h1><div className="results-actions"><button onClick={() => void download(false)}>Download summary CSV</button><button onClick={() => void download(true)}>Download detail CSV</button></div><div className="leaderboard admin-leaderboard">{results.leaderboard.map((entry) => <div className="leader-row" key={entry.participantIdentifier}><strong>#{entry.rank}</strong><span>{entry.displayName}</span><b>{entry.totalScore.toLocaleString()}</b></div>)}</div><h3 className="section-title">Question statistics</h3><div className="stats-grid">{results.questionStats.map((stat) => <div key={stat.questionId}><span>Q{stat.order}</span><b>{stat.correctCount}/{stat.answerCount}</b><small>{stat.awardedPoints.toLocaleString()} points awarded</small></div>)}</div></div>;
}

function CertificateVerifier({ onError }: { onError: (message: string) => void }) {
  const [code, setCode] = useState('');
  const [certificate, setCertificate] = useState<{ verificationCode: string; participantName: string; event: string; issuedAt: string } | null>(null);
  const verify = async (event: FormEvent) => { event.preventDefault(); try { setCertificate(await verifyCertificate(code)); } catch (cause) { setCertificate(null); onError(cause instanceof Error ? cause.message : 'Certificate not found'); } };
  return <div className="admin-page"><p className="eyebrow">CERTIFICATE CHECK</p><h1 className="admin-title">Verify a winner.</h1><form className="verify-form" onSubmit={verify}><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Verification code" required /><button>Verify certificate</button></form>{certificate && <div className="certificate-card"><span>VERIFIED CERTIFICATE</span><h2>{certificate.participantName}</h2><p>{certificate.event}</p><small>{certificate.verificationCode} · issued {new Date(certificate.issuedAt).toLocaleDateString()}</small></div>}</div>;
}
