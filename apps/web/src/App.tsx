import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { getCertificate, getParticipantResults, getQuizQuestions, joinSession } from './api';
import { createQuizSocket, type QuizSocket } from './socket';
import { AdminConsole } from './AdminConsole';
import type { JoinResponse, LeaderboardEntry, QuizQuestionItem, SessionResults, SessionState, SubmitAnswerResult } from './types';
import './styles.css';

type Screen = 'landing' | 'lobby' | 'question' | 'completed' | 'podium' | 'results';

const formatCode = (value: string) => value.replace(/\D/g, '').slice(0, 6);

/** Shuffles an array randomly (Fisher-Yates) for anti-cheating */
function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = temp;
  }
  return copy;
}

/** Formats long display names or emails cleanly */
function formatEmailOrName(name: string, email?: string): string {
  const val = (email || name || '').trim();
  if (val.includes('@')) {
    const [user, domain] = val.split('@');
    if (user && domain) {
      const shortUser = user.length > 10 ? `${user.slice(0, 8)}…` : user;
      return `${shortUser}@${domain}`;
    }
  }
  return val.length > 18 ? `${val.slice(0, 16)}…` : val;
}

/** Club logo SVG */
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
  const [email, setEmail] = useState('');
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
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestionItem[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [answerResult, setAnswerResult] = useState<SubmitAnswerResult | null>(null);
  const [myScore, setMyScore] = useState(0);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [totalPlayers, setTotalPlayers] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [results, setResults] = useState<SessionResults | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const socket = useMemo<QuizSocket | null>(() => {
    if (!join?.connectionToken) return null;
    return createQuizSocket(join.connectionToken, 'participant');
  }, [join?.connectionToken]);

  const loadQuestions = async () => {
    if (!join) return;
    try {
      const list = await getQuizQuestions(join.session.id, join.connectionToken);
      if (list && list.length > 0) {
        // Jumble question order AND jumble options per question to prevent cheating
        const jumbled = shuffleArray(list).map((q) => ({
          ...q,
          options: shuffleArray(q.options)
        }));
        setQuizQuestions(jumbled);
        setCurrentQIndex(0);
        setSelectedOption(null);
        setAnswerResult(null);
        setScreen('question');
      }
    } catch (cause) {
      console.error('Failed to load quiz questions', cause);
    }
  };

  useEffect(() => {
    if (!socket || !join) return;

    socket.on('session:state', (next) => {
      setState(next);
      if (next.status === 'LOBBY') {
        setScreen('lobby');
      } else if (next.status === 'QUESTION' || next.status === 'REVEAL' || next.status === 'LEADERBOARD') {
        // Start self-paced quiz if not already answering questions
        if (quizQuestions.length === 0) {
          void loadQuestions();
        }
      } else if (next.status === 'PODIUM') {
        setScreen('podium');
      } else if (next.status === 'ENDED') {
        void getParticipantResults(join.session.id, join.connectionToken)
          .then(setResults)
          .then(() => setScreen('results'))
          .catch(() => undefined);
      }
    });

    socket.on('question:started', () => {
      if (quizQuestions.length === 0) {
        void loadQuestions();
      }
    });

    socket.on('leaderboard:updated', (next) => {
      setLeaderboard(next.entries);
      setTotalPlayers(next.entries.length);
      const myEntry = next.entries.find((e) => e.displayName === join.participant.displayName);
      if (myEntry) {
        setMyRank(myEntry.rank);
        setMyScore(myEntry.totalScore);
      }
    });

    socket.on('podium', (next) => {
      setLeaderboard(next.entries);
      setScreen('podium');
    });

    socket.on('game:ended', () => {
      void getParticipantResults(join.session.id, join.connectionToken)
        .then(setResults)
        .then(() => setScreen('results'))
        .catch(() => undefined);
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
  }, [join, socket, quizQuestions.length]);

  const submitJoin = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      updateJoin(await joinSession(pin, displayName, email.trim() || undefined));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to join this quiz');
    } finally {
      setLoading(false);
    }
  };

  const submitAnswer = (optionId: string) => {
    const currentQ = quizQuestions[currentQIndex];
    if (!join || !currentQ || selectedOption) return;
    setSelectedOption(optionId);

    socket?.emit(
      'participant:submit-answer',
      {
        sessionId: join.session.id,
        questionId: currentQ.id,
        optionId
      },
      (response) => {
        if (!response.success) {
          setError(response.error?.message ?? 'Answer was not accepted');
          return;
        }
        if (response.data) {
          const res = response.data as SubmitAnswerResult;
          setAnswerResult(res);
          setMyScore(res.totalScore);
          setMyRank(res.currentRank);
          setTotalPlayers(res.totalParticipants);
        }
      }
    );
  };

  const nextQuestion = () => {
    if (currentQIndex < quizQuestions.length - 1) {
      setCurrentQIndex((prev) => prev + 1);
      setSelectedOption(null);
      setAnswerResult(null);
    } else {
      setScreen('completed');
    }
  };

  const reset = () => {
    updateJoin(null);
    setQuizQuestions([]);
    setCurrentQIndex(0);
    setSelectedOption(null);
    setAnswerResult(null);
    setMyScore(0);
    setMyRank(null);
    setTotalPlayers(null);
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
              Join a live quiz session hosted by your club. Answer questions at your own speed,
              watch your rank climb in real time, and earn your verified certificate.
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
                Display name / Nickname
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your nickname"
                  maxLength={35}
                  required
                />
              </label>
              <label>
                Email address <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>(optional, for certificate)</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@college.edu"
                  maxLength={100}
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

  const currentQ = quizQuestions[currentQIndex];

  return (
    <main className="app-shell game-shell">
      <header className="topbar">
        <ClubBrand small />
        <div className="topbar-right">
          {myRank !== null ? (
            <span className="rank-badge" title="Your live rank on the leaderboard">
              🏆 #{myRank}{totalPlayers ? ` / ${totalPlayers}` : ''} · {myScore.toLocaleString()} pts
            </span>
          ) : (
            <span className="live-chip"><i /> Live Session</span>
          )}
          <span className="participant-chip" title={join.participant.email || join.participant.displayName}>
            {formatEmailOrName(join.participant.displayName, join.participant.email)}
          </span>
        </div>
      </header>

      <section className="game-content">
        {screen === 'lobby' && (
          <Lobby
            title={join.session.quiz.title}
            pin={join.session.pin}
            participant={join.participant.displayName}
          />
        )}

        {screen === 'question' && currentQ && (
          <QuestionView
            question={currentQ}
            questionNumber={currentQIndex + 1}
            totalQuestions={quizQuestions.length}
            selectedOption={selectedOption}
            answerResult={answerResult}
            onAnswer={submitAnswer}
            onNext={nextQuestion}
            isLastQuestion={currentQIndex === quizQuestions.length - 1}
          />
        )}

        {screen === 'completed' && (
          <QuizCompletedView
            score={myScore}
            rank={myRank}
            totalPlayers={totalPlayers}
            totalQuestions={quizQuestions.length}
          />
        )}

        {screen === 'podium' && <PodiumView entries={leaderboard} />}
        {screen === 'results' && <ResultsView results={results} token={join.connectionToken} onReset={reset} />}
        {error && <p className="error-text floating-error">{error}</p>}
      </section>

      <footer>
        <span>SESSION {state?.sessionId.slice(-6).toUpperCase() ?? join.session.id.slice(-6).toUpperCase()}</span>
        <span>{state?.status ?? 'IN PROGRESS'}</span>
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
        Welcome, <b>{participant}</b>. Stay on this screen — the quiz will begin as soon as the host starts!
      </p>
      <div className="pulse-status"><i /> Waiting for host to start…</div>
    </div>
  );
}

function QuestionView({
  question,
  questionNumber,
  totalQuestions,
  selectedOption,
  answerResult,
  onAnswer,
  onNext,
  isLastQuestion
}: {
  question: QuizQuestionItem;
  questionNumber: number;
  totalQuestions: number;
  selectedOption: string | null;
  answerResult: SubmitAnswerResult | null;
  onAnswer: (id: string) => void;
  onNext: () => void;
  isLastQuestion: boolean;
}) {
  const [zoomed, setZoomed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(question.timerSeconds || 30);

  useEffect(() => {
    setTimeLeft(question.timerSeconds || 30);
  }, [question.id, question.timerSeconds]);

  useEffect(() => {
    if (selectedOption || answerResult || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, selectedOption, answerResult]);

  const apiBase = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api').replace(/\/+$/, '');
  const mediaUrl = question.mediaAssetId
    ? `${apiBase}/media/${question.mediaAssetId}`
    : '';
  // Support both REST shape (mediaAsset.mimeType) and socket shape (mediaMimeType)
  const resolvedMimeType =
    question.mediaAsset?.mimeType ??
    (question as unknown as { mediaMimeType?: string | null }).mediaMimeType ??
    null;
  const isVideo = Boolean(mediaUrl && resolvedMimeType?.startsWith('video/'));

  return (
    <div className="question-stage">
      <div className="question-header">
        <span>
          Question {String(questionNumber).padStart(2, '0')} of {totalQuestions}
        </span>
        <strong className={timeLeft <= 5 ? 'urgent' : ''}>{timeLeft}s</strong>
      </div>
      <div className="progress-track">
        <span style={{ width: `${Math.min(100, (timeLeft / (question.timerSeconds || 30)) * 100)}%` }} />
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
              <span
                style={{ display: 'inline-block', font: '500 11px var(--mono)', color: 'var(--teal)', marginTop: 8, cursor: 'pointer' }}
                onClick={() => setZoomed(true)}
              >
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
        </div>
      )}

      <div className="option-grid">
        {question.options.map((option, index) => {
          const isSelected = selectedOption === option.id;
          let optClass = 'option';
          if (isSelected) {
            optClass += ' selected';
            if (answerResult) {
              optClass += answerResult.isCorrect ? ' correct-answer' : ' wrong-answer';
            }
          }
          return (
            <button
              className={optClass}
              disabled={Boolean(selectedOption) || timeLeft === 0}
              onClick={() => onAnswer(option.id)}
              key={option.id}
            >
              <span>{String.fromCharCode(65 + index)}</span>
              {option.text}
            </button>
          );
        })}
      </div>

      {/* Instant Feedback Banner */}
      {answerResult && (
        <div className={`feedback-banner ${answerResult.isCorrect ? 'correct' : 'wrong'}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 16 }}>
              {answerResult.isCorrect ? '✓ Correct Answer!' : '✗ Incorrect'}
            </strong>
            <span style={{ font: '700 14px var(--mono)', color: answerResult.isCorrect ? 'var(--teal)' : '#ef4444' }}>
              {answerResult.isCorrect ? `+${answerResult.awardedPoints} pts` : '+0 pts'}
            </span>
          </div>
          {answerResult.explanation && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              <b>Forensic Insight:</b> {answerResult.explanation}
            </p>
          )}
        </div>
      )}

      {timeLeft === 0 && !selectedOption && (
        <div className="feedback-banner wrong">
          <strong>⏱️ Time's up on this question!</strong>
        </div>
      )}

      {/* Direct Next Question Action */}
      {(selectedOption || timeLeft === 0) && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button className="btn-next-question" onClick={onNext}>
            {isLastQuestion ? 'Complete Quiz ✓' : 'Next Question →'}
          </button>
        </div>
      )}
    </div>
  );
}

function QuizCompletedView({
  score,
  rank,
  totalPlayers,
  totalQuestions
}: {
  score: number;
  rank: number | null;
  totalPlayers: number | null;
  totalQuestions: number;
}) {
  return (
    <div className="center-stage">
      <span className="eyebrow">All Questions Answered</span>
      <h2>Quiz Completed! 🎉</h2>
      <div className="final-score" style={{ margin: '20px auto' }}>
        <strong>{score.toLocaleString()}</strong>
        <span>total points earned</span>
      </div>
      <div
        style={{
          margin: '16px auto 24px',
          padding: '16px 28px',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: 10,
          border: '1px solid var(--border)',
          maxWidth: 380
        }}
      >
        <p style={{ font: '600 15px var(--mono)', color: 'var(--teal)', margin: 0 }}>
          {rank !== null ? `Current Position: #${rank} of ${totalPlayers || '—'}` : 'Position calculating…'}
        </p>
        <small style={{ color: 'var(--text-dim)', marginTop: 6, display: 'block' }}>
          {totalQuestions} questions completed
        </small>
      </div>
      <p className="muted" style={{ maxWidth: 440, margin: '0 auto 20px' }}>
        Your answers have been securely recorded. Please wait for the host to conclude the session to reveal the final podium and download certificates.
      </p>
      <div className="pulse-status"><i /> Waiting for host to reveal winners…</div>
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
            <b title={entry.displayName}>{entry.displayName}</b>
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
