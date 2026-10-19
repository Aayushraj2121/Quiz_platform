import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { getCertificate, getParticipantResults, joinSession, listSessions, loginAdmin } from './api';
import { createQuizSocket, type QuizSocket } from './socket';
import { AdminConsole } from './AdminConsole';
import type { JoinResponse, LeaderboardEntry, PersonalReveal, SafeQuestion, SessionResults, SessionState } from './types';
import './styles.css';

type Screen = 'landing' | 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'podium' | 'results';

const formatCode = (value: string) => value.replace(/\D/g, '').slice(0, 6);

/** Club logo SVG — inline so it works without a public folder asset */
function ClubLogo({ size = 40 }: { size?: number }) {
  return (
    <img
      src="/club-logo.png"
      alt="CTPDF Club logo"
      width={size}
      height={size}
      className="club-logo"
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
    />
  );
}

function ClubBrand({ small = false }: { small?: boolean }) {
  return (
    <div className="club-brand">
      <ClubLogo size={small ? 32 : 40} />
      <div className="club-name">
        <span className="club-name-main">
          {small ? 'CTPDF Club' : 'Cybersecurity, Threat Prevention & Digital Forensics Club'}
        </span>
        <span className="club-name-sub">Quiz Platform</span>
      </div>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<'participant' | 'host'>('participant');
  const [screen, setScreen] = useState<Screen>('landing');
  const [pin, setPin] = useState(() => new URLSearchParams(window.location.search).get('pin')?.replace(/\D/g, '').slice(0, 6) ?? '');
  const [displayName, setDisplayName] = useState('');
  const [join, setJoin] = useState<JoinResponse | null>(() => {
    try {
      const stored = sessionStorage.getItem('ctpdf_quiz_join');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const updateJoin = (next: JoinResponse | null) => {
    setJoin(next);
    try {
      if (next) {
        sessionStorage.setItem('ctpdf_quiz_join', JSON.stringify(next));
      } else {
        sessionStorage.removeItem('ctpdf_quiz_join');
      }
    } catch {}
  };
  const [state, setState] = useState<SessionState | null>(null);
  const [question, setQuestion] = useState<SafeQuestion | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [personalReveal, setPersonalReveal] = useState<PersonalReveal | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
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
      setExplanation(null);
      setRemainingMs(new Date(next.deadline).getTime() - Date.now());
      move('question');
    });
    socket.on('question:timer', (next) => setRemainingMs(next.remainingMs));
    socket.on('leaderboard', (next) => {
      setLeaderboard(next.entries);
      move('leaderboard');
    });
    socket.on('leaderboard:updated', (next) => setLeaderboard(next.entries));
    socket.on('reveal', (next) => {
      setExplanation(next.explanation);
    });
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
    socket.on('connect', () => {
      socket.emit('participant:join-game', { sessionId: join.session.id });
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
      updateJoin(await joinSession(pin, displayName));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to join this quiz');
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
    updateJoin(null);
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

        {/* Top navigation bar */}
        <header className="landing-top">
          <ClubBrand />
          {!pin && (
            <button className="text-button" onClick={() => setMode('host')} style={{ marginTop: 0 }}>
              Host console →
            </button>
          )}
        </header>

        {/* Hero section */}
        <div className="hero-wrapper">
          <div className="hero-left">
            <span className="eyebrow">Live Quiz Platform</span>
            <h1 className="hero-title">
              Test Your <span>Cyber</span><br />Knowledge
            </h1>
            <p className="hero-copy">
              Join a live quiz session hosted by your club. Answer questions in real time,
              compete on the leaderboard, and earn your certificate.
            </p>
          </div>

          {/* Join card */}
          <div className="join-card">
            <h3>Join a Quiz Session</h3>
            <p>Enter the 6-digit PIN shared by your host.</p>
            <form onSubmit={submitJoin}>
              <label>
                Game PIN
                <input
                  value={pin}
                  onChange={(e) => setPin(formatCode(e.target.value))}
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  required
                />
              </label>
              <label>
                Display name
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  maxLength={40}
                  required
                />
              </label>
              {error && <p className="error-text">{error}</p>}
              <button disabled={loading || pin.length !== 6 || !displayName.trim()}>
                {loading ? 'Connecting…' : 'Join Quiz →'}
              </button>
            </form>
            <p className="join-hint">Scan the host's QR code to fill the PIN automatically.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell game-shell">
      <header className="topbar">
        <ClubBrand small />
        <span className="live-chip"><i /> Live Session</span>
        <span className="participant-name">{join.participant.displayName}</span>
      </header>
      <section className="game-content">
        {screen === 'lobby' && <Lobby title={join.session.quiz.title} pin={join.session.pin} participant={join.participant.displayName} />}
        {screen === 'question' && question && <QuestionView question={question} remainingMs={remainingMs} selectedOption={selectedOption} onAnswer={submitAnswer} />}
        {screen === 'reveal' && <RevealView reveal={personalReveal} explanation={explanation} />}
        {screen === 'leaderboard' && <LeaderboardView entries={leaderboard} current={join.participant.displayName} />}
        {screen === 'podium' && <PodiumView entries={leaderboard} />}
        {screen === 'results' && <ResultsView results={results} token={join.connectionToken} onReset={reset} />}
        {error && <p className="error-text floating-error">{error}</p>}
      </section>
      <footer>
        <span>SESSION {state?.sessionId.slice(-6).toUpperCase() ?? join.session.id.slice(-6).toUpperCase()}</span>
        <span>{state?.status ?? 'LOBBY'}</span>
      </footer>
    </main>
  );
}

function Lobby({ title, pin, participant }: { title: string; pin: string; participant: string }) {
  return (
    <div className="center-stage">
      <span className="eyebrow">You're in</span>
      <h2>{title}</h2>
      <div className="pin-display">
        <span>Join Code</span>
        <strong>{pin}</strong>
      </div>
      <p className="muted">
        Welcome, <b>{participant}</b>. Stay on this screen — the host will start the quiz shortly.
      </p>
      <div className="pulse-status"><i /> Waiting for host</div>
    </div>
  );
}

function QuestionView({ question, remainingMs, selectedOption, onAnswer }: { question: SafeQuestion; remainingMs: number; selectedOption: string | null; onAnswer: (id: string) => void }) {
  const [zoomed, setZoomed] = useState(false);
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mediaUrl = question.mediaAssetId ? `${import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:4000/api'}/media/${question.mediaAssetId}` : '';
  const isVideo = mediaUrl && question.mediaMimeType?.startsWith('video/');

  return (
    <div className="question-stage">
      <div className="question-header">
        <span>Question {String(question.questionIndex + 1).padStart(2, '0')}</span>
        <strong className={seconds <= 5 ? 'urgent' : ''}>{seconds}s</strong>
      </div>
      <div className="progress-track">
        <span style={{ width: `${Math.min(100, (remainingMs / (question.timerSeconds * 1000)) * 100)}%` }} />
      </div>
      <h2>{question.text}</h2>

      {mediaUrl && (
        <div style={{ position: 'relative', margin: '16px 0 20px', textAlign: 'center' }}>
          {isVideo ? (
            <video className="question-media" src={mediaUrl} controls preload="metadata" aria-label="Question media" />
          ) : (
            <>
              <img
                className="question-media"
                src={mediaUrl}
                alt="Question media"
                style={{ cursor: 'zoom-in', maxHeight: '360px', width: 'auto', maxWidth: '100%' }}
                onClick={() => setZoomed(true)}
              />
              <span style={{ display: 'inline-block', font: '500 11px var(--mono)', color: 'var(--teal)', marginTop: 8, cursor: 'pointer' }} onClick={() => setZoomed(true)}>
                🔍 Tap / Click to inspect in full resolution
              </span>
            </>
          )}
        </div>
      )}

      {zoomed && !isVideo && (
        <div
          onClick={() => setZoomed(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(6, 16, 29, 0.94)',
            backdropFilter: 'blur(10px)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            cursor: 'zoom-out'
          }}
        >
          <button
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              background: 'var(--bg-card)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: '50%',
              width: 44,
              height: 44,
              fontSize: 20,
              cursor: 'pointer'
            }}
            onClick={() => setZoomed(false)}
          >
            ✕
          </button>
          <img
            src={mediaUrl}
            alt="Enlarged forensic view"
            style={{
              maxWidth: '92vw',
              maxHeight: '82vh',
              objectFit: 'contain',
              borderRadius: 8,
              border: '1px solid var(--border-hi)',
              boxShadow: '0 12px 48px rgba(0,0,0,0.85)'
            }}
          />
          <span style={{ font: '500 11px var(--mono)', color: 'var(--text-muted)', marginTop: 14 }}>
            Click anywhere to close full screen view
          </span>
        </div>
      )}

      <div className="option-grid">
        {question.options.map((option, index) => (
          <button
            className={`option ${selectedOption === option.id ? 'selected' : ''}`}
            disabled={Boolean(selectedOption) || seconds === 0}
            onClick={() => onAnswer(option.id)}
            key={option.id}
          >
            <span>{String.fromCharCode(65 + index)}</span>
            {option.text}
          </button>
        ))}
      </div>
      <p className="muted">
        {selectedOption ? 'Answer locked — waiting for results.' : 'Choose carefully. Your response time affects your score.'}
      </p>
    </div>
  );
}

function RevealView({ reveal, explanation }: { reveal: PersonalReveal | null; explanation?: string | null }) {
  return (
    <div className="center-stage reveal-stage">
      <span className="eyebrow">Your Result</span>
      <div className={`result-icon ${reveal?.correct ? 'correct' : 'wrong'}`}>
        {reveal?.correct ? '✓' : '✗'}
      </div>
      <h2>{reveal?.correct ? 'Correct!' : 'Incorrect'}</h2>
      <p className="score-callout">
        {reveal?.points ?? 0}<small> pts</small>
      </p>
      <p className="muted">
        {reveal?.streak ? `${reveal.streak}-answer streak 🔥` : 'Streak reset — get the next one!'}
      </p>
      {explanation && (
        <div className="admin-callout" style={{ textAlign: 'left', margin: '24px auto 16px', maxWidth: 640 }}>
          <span>FORENSIC BREAKDOWN</span>
          <p>{explanation}</p>
        </div>
      )}
      <div className="pulse-status"><i /> Leaderboard loading…</div>
    </div>
  );
}

function LeaderboardView({ entries, current }: { entries: LeaderboardEntry[]; current: string }) {
  return (
    <div className="board-stage">
      <span className="eyebrow">Live Rankings</span>
      <h2>Leaderboard</h2>
      <div className="leaderboard">
        {entries.map((entry) => (
          <div className={`leader-row ${entry.displayName === current ? 'current' : ''}`} key={entry.participantIdentifier}>
            <strong>#{entry.rank}</strong>
            <span>{entry.displayName}</span>
            <b>{entry.totalScore.toLocaleString()}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function PodiumView({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="center-stage">
      <span className="eyebrow">Quiz Complete</span>
      <h2>Final Standings</h2>
      <div className="podium">
        {entries.slice(0, 3).map((entry, index) => (
          <div className={`podium-place place-${index + 1}`} key={entry.participantIdentifier}>
            <span>0{index + 1}</span>
            <b>{entry.displayName}</b>
            <small>{entry.totalScore.toLocaleString()} pts</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultsView({ results, token, onReset }: { results: SessionResults | null; token: string; onReset: () => void }) {
  const [certificate, setCertificate] = useState<{ verificationCode: string; participantName: string; event: string; issuedAt: string } | null>(null);
  const [certificateError, setCertificateError] = useState('');
  const participant = results?.participants[0];
  const loadCertificate = async () => {
    try { setCertificate(await getCertificate(token)); }
    catch (cause) { setCertificateError(cause instanceof Error ? cause.message : 'Certificate is not available yet'); }
  };
  return (
    <div className="center-stage">
      <span className="eyebrow">Session Complete</span>
      <h2>Your Results</h2>
      {results && (
        <div className="final-score">
          <strong>{participant?.totalScore?.toLocaleString() ?? '0'}</strong>
          <span>total points this session</span>
        </div>
      )}
      <button onClick={() => void loadCertificate()}>View Certificate</button>
      {certificate && (
        <div className="certificate-card participant-certificate">
          <span>Verified Certificate</span>
          <h3>{certificate.participantName}</h3>
          <p>{certificate.event}</p>
          <small>{certificate.verificationCode}</small>
        </div>
      )}
      {certificateError && <p className="error-text">{certificateError}</p>}
      <button className="text-button" onClick={onReset} style={{ marginTop: 20 }}>
        ← Return to join screen
      </button>
    </div>
  );
}
