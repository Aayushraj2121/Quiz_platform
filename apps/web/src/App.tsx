import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { getCertificate, getParticipantResults, joinSession, listSessions, loginAdmin } from './api';
import { createQuizSocket, type QuizSocket } from './socket';
import { AdminConsole } from './AdminConsole';
import type { JoinResponse, LeaderboardEntry, PersonalReveal, SafeQuestion, SessionResults, SessionState } from './types';

type Screen = 'landing' | 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'podium' | 'results';

const formatCode = (value: string) => value.replace(/\D/g, '').slice(0, 6);

export default function App() {
  const [mode, setMode] = useState<'participant' | 'host'>('participant');
  const [screen, setScreen] = useState<Screen>('landing');
  const [pin, setPin] = useState(() => new URLSearchParams(window.location.search).get('pin')?.replace(/\D/g, '').slice(0, 6) ?? '');
  const [displayName, setDisplayName] = useState('');
  const [join, setJoin] = useState<JoinResponse | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [question, setQuestion] = useState<SafeQuestion | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [personalReveal, setPersonalReveal] = useState<PersonalReveal | null>(null);
  const [results, setResults] = useState<SessionResults | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const socket = useMemo<QuizSocket | null>(() => {
    if (!join?.connectionToken) return null;
    return createQuizSocket(join.connectionToken, 'participant');
  }, [join?.connectionToken]);

  useEffect(() => {
    if (!socket || !join) return;
    const move = (next: Screen) => setScreen(next);
    socket.on('session:state', (next) => {
      setState(next);
      if (next.status === 'LOBBY') move('lobby');
      if (next.status === 'QUESTION') move('question');
      if (next.status === 'REVEAL') move('reveal');
      if (next.status === 'LEADERBOARD') move('leaderboard');
      if (next.status === 'PODIUM') move('podium');
      if (next.status === 'ENDED') move('results');
    });
    socket.on('question:started', (next) => {
      setQuestion(next);
      setSelectedOption(null);
      setPersonalReveal(null);
      setRemainingMs(new Date(next.deadline).getTime() - Date.now());
      move('question');
    });
    socket.on('question:timer', (next) => setRemainingMs(next.remainingMs));
    socket.on('leaderboard', (next) => {
      setLeaderboard(next.entries);
      move('leaderboard');
    });
    socket.on('leaderboard:updated', (next) => setLeaderboard(next.entries));
    socket.on('reveal:personal', (next) => {
      setPersonalReveal(next);
      move('reveal');
    });
    socket.on('podium', (next) => {
      setLeaderboard(next.entries);
      move('podium');
    });
    socket.on('game:ended', () => {
      void getParticipantResults(join.session.id, join.connectionToken).then(setResults).then(() => move('results')).catch(() => undefined);
    });
    socket.on('session:error', (next) => setError(next.message));
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [join, socket]);

  const submitJoin = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      setJoin(await joinSession(pin, displayName));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to join this game');
    } finally {
      setLoading(false);
    }
  };

  const submitAnswer = (optionId: string) => {
    if (!join || !question || selectedOption) return;
    setSelectedOption(optionId);
    socket?.emit('participant:submit-answer', {
      sessionId: join.session.id,
      questionId: question.questionId,
      optionId
    }, (response) => {
      if (!response.success) setError(response.error?.message ?? 'Answer was not accepted');
    });
  };

  const reset = () => {
    setJoin(null);
    setQuestion(null);
    setLeaderboard([]);
    setResults(null);
    setScreen('landing');
  };

  if (!join) {
    if (mode === 'host') {
      return <AdminConsole onBack={() => setMode('participant')} />;
    }
    return (
      <main className="app-shell landing-shell">
        <div className="noise" />
        <section className="hero-panel">
          <p className="eyebrow">CYBERSECURITY · THREAT PREVENTION · DIGITAL FORENSICS</p>
          <h1>GLITCH<br /><span>IN REALITY</span></h1>
          <p className="hero-copy">A live investigation of what happens when human judgment meets a digital threat.</p>
          <form className="join-card" onSubmit={submitJoin}>
            <label>Game PIN<input value={pin} onChange={(event) => setPin(formatCode(event.target.value))} inputMode="numeric" placeholder="000000" required /></label>
            <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" maxLength={40} required /></label>
            {error && <p className="error-text">{error}</p>}
            <button disabled={loading || pin.length !== 6 || !displayName.trim()}>{loading ? 'CONNECTING…' : 'ENTER THE INVESTIGATION'}</button>
          </form>
          <p className="muted join-hint">Scan the host’s QR code to fill the game PIN automatically.</p>
          <button className="text-button" onClick={() => setMode('host')}>Open host console →</button>
          <p className="event-meta">22 OCTOBER 2026 · 4:20–5:30 PM<br />APJ ABDUL KALAM AUDITORIUM</p>
        </section>
      </main>
    );
  }

  function HostPanel({ onBack }: { onBack: () => void }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [token, setToken] = useState('');
    const [sessionId, setSessionId] = useState('');
    const [questionIndex, setQuestionIndex] = useState(0);
    const [status, setStatus] = useState('LOBBY');
    const [sessions, setSessions] = useState<Array<{ id: string; pin: string; status: string; quiz?: { title: string }; currentQuestionIndex: number }>>([]);
    const [socket, setSocket] = useState<QuizSocket | null>(null);
    const [error, setError] = useState('');

    const login = async (event: FormEvent) => {
      event.preventDefault();
      setError('');
      try {
        const result = await loginAdmin(username, password);
        setToken(result.token);
        setSessions((await listSessions(result.token)).items);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to sign in');
      }
    };

    const connect = () => {
      if (!token || !sessionId.trim()) return;
      socket?.disconnect();
      const next = createQuizSocket(token, 'host');
      next.on('session:state', (state) => {
        setStatus(state.status);
        setQuestionIndex(state.currentQuestionIndex);
      });
      next.on('session:error', (event) => setError(event.message));
      next.on('connect_error', () => setError('Host connection was rejected'));
      next.connect();
      next.emit('host:join', { sessionId: sessionId.trim() }, (response) => {
        if (!response.success) setError(response.error?.message ?? 'Unable to join session');
      });
      setSocket(next);
    };

    const command = (event: 'host:start-question' | 'host:reveal' | 'host:extend' | 'host:leaderboard' | 'host:end') => {
      if (!socket || !sessionId) return;
      if (event === 'host:start-question') {
        socket.emit(event, { sessionId, questionIndex }, (response) => {
          if (!response.success) setError(response.error?.message ?? 'Command failed');
        });
        return;
      }
      if (event === 'host:extend') {
        socket.emit(event, { sessionId, seconds: 10 }, (response) => {
          if (!response.success) setError(response.error?.message ?? 'Command failed');
        });
        return;
      }
      socket.emit(event, { sessionId }, (response) => {
        if (!response.success) setError(response.error?.message ?? 'Command failed');
      });
    };

    return (
      <main className="app-shell landing-shell">
        <section className="host-panel">
          <button className="back-button" onClick={onBack}>← Participant entry</button>
          <p className="eyebrow">ADMIN OPERATIONS</p>
          <h2>Host console</h2>
          {!token ? (
            <form className="join-card" onSubmit={login}>
              <label>Admin username<input value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
              <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              {error && <p className="error-text">{error}</p>}
              <button>Sign in to control room</button>
            </form>
          ) : (
            <>
              <div className="host-toolbar">
                <label>Session ID<input value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="Paste session ID" /></label>
                <button onClick={connect} disabled={!sessionId.trim()}>Connect host</button>
              </div>
              <div className="host-sessions">
                <p className="eyebrow">RECENT SESSIONS</p>
                {sessions.map((session) => <button className="session-row" key={session.id} onClick={() => setSessionId(session.id)}><span>{session.quiz?.title ?? 'Untitled quiz'}</span><b>{session.pin}</b><small>{session.status}</small></button>)}
              </div>
              <div className="host-controls">
                <div className="control-status"><span>LIVE STATE</span><strong>{status}</strong></div>
                <label>Question index<input type="number" min="0" value={questionIndex} onChange={(event) => setQuestionIndex(Number(event.target.value))} /></label>
                <button onClick={() => command('host:start-question')}>Start question</button>
                <button onClick={() => command('host:reveal')} disabled={status !== 'QUESTION'}>Reveal answer</button>
                <button onClick={() => command('host:extend')} disabled={status !== 'QUESTION'}>+10 seconds</button>
                <button onClick={() => command('host:leaderboard')} disabled={status !== 'REVEAL'}>Show leaderboard</button>
                <button className="danger-button" onClick={() => command('host:end')}>End game</button>
              </div>
              {error && <p className="error-text">{error}</p>}
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell game-shell">
      <header className="topbar"><span className="brand-mark">G/IR</span><span className="live-chip"><i /> LIVE INVESTIGATION</span><span className="participant-name">{join.participant.displayName}</span></header>
      <section className="game-content">
        {screen === 'lobby' && <Lobby title={join.session.quiz.title} pin={join.session.pin} participant={join.participant.displayName} />}
        {screen === 'question' && question && <QuestionView question={question} remainingMs={remainingMs} selectedOption={selectedOption} onAnswer={submitAnswer} />}
        {screen === 'reveal' && <RevealView reveal={personalReveal} />}
        {screen === 'leaderboard' && <LeaderboardView entries={leaderboard} current={join.participant.displayName} />}
        {screen === 'podium' && <PodiumView entries={leaderboard} />}
        {screen === 'results' && <ResultsView results={results} token={join.connectionToken} onReset={reset} />}
        {error && <p className="error-text floating-error">{error}</p>}
      </section>
      <footer><span>SESSION {state?.sessionId.slice(-6).toUpperCase() ?? join.session.id.slice(-6).toUpperCase()}</span><span>{state?.status ?? 'LOBBY'}</span></footer>
    </main>
  );
}

function Lobby({ title, pin, participant }: { title: string; pin: string; participant: string }) {
  return <div className="center-stage"><p className="eyebrow">YOU ARE IN</p><h2>{title}</h2><div className="pin-display"><span>JOIN CODE</span><strong>{pin}</strong></div><p className="muted">Welcome, <b>{participant}</b>. Stay on this screen until the host starts the investigation.</p><div className="pulse-status"><i /> Waiting for host</div></div>;
}

function QuestionView({ question, remainingMs, selectedOption, onAnswer }: { question: SafeQuestion; remainingMs: number; selectedOption: string | null; onAnswer: (id: string) => void }) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mediaUrl = question.mediaAssetId ? `${import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:4000/api'}/media/${question.mediaAssetId}` : '';
  return <div className="question-stage"><div className="question-header"><span>CASE FILE {String(question.questionIndex + 1).padStart(2, '0')}</span><strong className={seconds <= 5 ? 'urgent' : ''}>{seconds}s</strong></div><div className="progress-track"><span style={{ width: `${Math.min(100, (remainingMs / (question.timerSeconds * 1000)) * 100)}%` }} /></div><h2>{question.text}</h2>{mediaUrl && <img className="question-media" src={mediaUrl} alt="Question media" /> }<div className="option-grid">{question.options.map((option, index) => <button className={`option ${selectedOption === option.id ? 'selected' : ''}`} disabled={Boolean(selectedOption) || seconds === 0} onClick={() => onAnswer(option.id)} key={option.id}><span>{String.fromCharCode(65 + index)}</span>{option.text}</button>)}</div><p className="muted">{selectedOption ? 'Answer locked. Watch for the reveal.' : 'Choose carefully. Your response time affects your score.'}</p></div>;
}

function RevealView({ reveal }: { reveal: PersonalReveal | null }) {
  return <div className="center-stage reveal-stage"><p className="eyebrow">PERSONAL DEBRIEF</p><div className={`result-icon ${reveal?.correct ? 'correct' : 'wrong'}`}>{reveal?.correct ? '✓' : '×'}</div><h2>{reveal?.correct ? 'Threat neutralised.' : 'Signal lost.'}</h2><p className="score-callout">{reveal?.points ?? 0}<small> POINTS</small></p><p className="muted">{reveal?.streak ? `${reveal.streak} answer streak` : 'Your streak resets here.'}</p><div className="pulse-status"><i /> Leaderboard incoming</div></div>;
}

function LeaderboardView({ entries, current }: { entries: LeaderboardEntry[]; current: string }) {
  return <div className="board-stage"><p className="eyebrow">LIVE RANKING</p><h2>Who sees the pattern?</h2><div className="leaderboard">{entries.map((entry) => <div className={`leader-row ${entry.displayName === current ? 'current' : ''}`} key={entry.participantIdentifier}><strong>#{entry.rank}</strong><span>{entry.displayName}</span><b>{entry.totalScore.toLocaleString()}</b></div>)}</div></div>;
}

function PodiumView({ entries }: { entries: LeaderboardEntry[] }) {
  return <div className="center-stage"><p className="eyebrow">INVESTIGATION COMPLETE</p><h2>The pattern is yours now.</h2><div className="podium">{entries.slice(0, 3).map((entry, index) => <div className={`podium-place place-${index + 1}`} key={entry.participantIdentifier}><span>0{index + 1}</span><b>{entry.displayName}</b><small>{entry.totalScore.toLocaleString()} pts</small></div>)}</div></div>;
}

function ResultsView({ results, token, onReset }: { results: SessionResults | null; token: string; onReset: () => void }) {
  const [certificate, setCertificate] = useState<{ verificationCode: string; participantName: string; event: string; issuedAt: string } | null>(null);
  const [certificateError, setCertificateError] = useState('');
  const participant = results?.participants[0];
  const loadCertificate = async () => {
    try { setCertificate(await getCertificate(token)); } catch (cause) { setCertificateError(cause instanceof Error ? cause.message : 'Certificate is not available yet'); }
  };
  return <div className="center-stage"><p className="eyebrow">CASE CLOSED</p><h2>Your results are ready.</h2>{results && <div className="final-score"><strong>{participant?.totalScore?.toLocaleString() ?? '0'}</strong><span>your session points</span></div>}<button onClick={() => void loadCertificate()}>View certificate</button>{certificate && <div className="certificate-card participant-certificate"><span>VERIFIED CERTIFICATE</span><h3>{certificate.participantName}</h3><p>{certificate.event}</p><small>{certificate.verificationCode}</small></div>}{certificateError && <p className="error-text">{certificateError}</p>}<button className="text-button" onClick={onReset}>RETURN TO ENTRY</button></div>;
}
