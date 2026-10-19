import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, LayoutDashboard, ListChecks, Radio, Users, Trophy, Settings, LogOut, Plus, Trash2, Pencil, Play, Copy, Download, RefreshCw, Wifi, WifiOff, ArrowRight, CheckCircle2, XCircle, Menu, X, ExternalLink } from "lucide-react";

const starterQuiz = {
  id: "cyber-basics",
  title: "Cybersecurity Basics",
  description: "A quick challenge for curious security minds.",
  questions: [
    { id: "q1", prompt: "What does the CIA triad stand for?", options: ["Control, Internet, Access", "Confidentiality, Integrity, Availability", "Cyber Intelligence Agency", "Connection, Identity, Authorization"], correct: 1, seconds: 20, points: 100 },
    { id: "q2", prompt: "Which protocol secures web traffic using TLS?", options: ["HTTP", "FTP", "HTTPS", "Telnet"], correct: 2, seconds: 20, points: 100 },
    { id: "q3", prompt: "What is phishing?", options: ["A hardware failure", "A deceptive attempt to steal information", "A backup method", "A type of firewall"], correct: 1, seconds: 20, points: 100 },
    { id: "q4", prompt: "What is the main job of a firewall?", options: ["Filter network traffic", "Create user accounts", "Encrypt every file automatically", "Increase internet speed"], correct: 0, seconds: 20, points: 100 },
    { id: "q5", prompt: "Which is the safest password practice?", options: ["Reuse one password", "Use your birth date", "Share passwords with teammates", "Use long, unique passwords"], correct: 3, seconds: 20, points: 100 }
  ]
};
const KEY = "quizforge-person2-v1";
const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    return saved || { quizzes: [starterQuiz], session: null, results: [] };
  } catch { return { quizzes: [starterQuiz], session: null, results: [] }; }
};
const save = data => localStorage.setItem(KEY, JSON.stringify(data));
const newId = () => Math.random().toString(36).slice(2, 9);
const newPin = () => String(Math.floor(100000 + Math.random() * 900000));
const esc = value => String(value ?? "");
function App() {
  const [db, setDb] = useState(load);
  const [route, setRoute] = useState(location.hash.slice(1) || "/");
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState("");
  const [loginUser, setLoginUser] = useState("admin");
  const [loginPass, setLoginPass] = useState("");
  const [loggedIn, setLoggedIn] = useState(sessionStorage.getItem("quizforge-admin") === "yes");
  const [joinPin, setJoinPin] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [activeQuizId, setActiveQuizId] = useState(db.quizzes[0]?.id || "");
  const [editQuiz, setEditQuiz] = useState(null);
  const [playerId, setPlayerId] = useState(sessionStorage.getItem("quizforge-player") || "");
  const [answer, setAnswer] = useState(null);
  const [timeLeft, setTimeLeft] = useState(20);

  useEffect(() => {
    const onHash = () => setRoute(location.hash.slice(1) || "/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => { save(db); }, [db]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3200);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (route !== "/play" || !db.session || !playerId) return;
    if (db.session.status !== "playing" || answer !== null) return;
    if (timeLeft <= 0) { setAnswer(-1); return; }
    const timer = setTimeout(() => setTimeLeft(t => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [route, db.session, playerId, answer, timeLeft]);
  const go = path => { location.hash = path; setMobileNav(false); };
  const update = fn => setDb(prev => fn(structuredClone(prev)));
  const quiz = db.quizzes.find(q => q.id === activeQuizId) || db.quizzes[0];
  const session = db.session;
  const currentQuestion = session ? (db.quizzes.find(q => q.id === session.quizId)?.questions[session.questionIndex]) : null;
  const participants = session?.participants || [];
  const myPlayer = participants.find(p => p.id === playerId);
  const ranked = [...participants].sort((a,b) => b.score - a.score);
  const stats = useMemo(() => ({
    quizzes: db.quizzes.length,
    questions: db.quizzes.reduce((n, q) => n + q.questions.length, 0),
    players: db.results.reduce((n, r) => n + (r.participants?.length || 0), 0)
  }), [db.quizzes, db.results]);

  function login(e) {
    e.preventDefault();
    if (loginUser.trim() === "admin" && loginPass === "quiz123") {
      setLoggedIn(true); sessionStorage.setItem("quizforge-admin", "yes");
      setNotice("Demo admin login successful."); go("/admin");
    } else setNotice("Invalid demo credentials. Try admin / quiz123.");
  }
  function logout() { setLoggedIn(false); sessionStorage.removeItem("quizforge-admin"); go("/login"); }
  function startSession() {
    if (!quiz || !quiz.questions.length) return setNotice("Add at least one question first.");
    const pin = newPin();
    update(d => { d.session = { id: newId(), pin, quizId: quiz.id, status: "lobby", questionIndex: 0, participants: [], startedAt: Date.now() }; });
    setNotice(`Lobby created. PIN: ${pin}`); go("/host");
  }
  function joinSession(e) {
    e.preventDefault();
    const s = db.session;
    if (!s || s.pin !== joinPin.trim() || s.status === "finished") return setNotice("PIN not found or session has ended.");
    if (!playerName.trim()) return setNotice("Enter your display name.");
    if (s.participants.some(p => p.name.toLowerCase() === playerName.trim().toLowerCase())) return setNotice("That name is already in use.");
    const id = newId();
    update(d => { d.session.participants.push({ id, name: playerName.trim(), score: 0, answers: [], connected: true }); });
    setPlayerId(id); sessionStorage.setItem("quizforge-player", id); setAnswer(null); setTimeLeft(20); go("/play");
  }
  function beginGame() {
    if (!session?.participants.length) return setNotice("Ask at least one participant to join first.");
    update(d => { d.session.status = "playing"; d.session.questionIndex = 0; });
    setAnswer(null); setTimeLeft(20); go("/host");
  }
  function submitAnswer(index) {
    if (answer !== null || !currentQuestion || !myPlayer || session.status !== "playing") return;
    setAnswer(index);
    update(d => {
      const s = d.session, p = s?.participants.find(x => x.id === playerId);
      const q = d.quizzes.find(x => x.id === s?.quizId)?.questions[s?.questionIndex];
      if (!p || !q || p.answers.some(a => a.questionId === q.id)) return;
      const correct = index === q.correct;
      p.answers.push({ questionId: q.id, selected: index, correct });
      if (correct) p.score += q.points || 100;
    });
  }
  function nextHostQuestion() {
    if (!session) return;
    const qz = db.quizzes.find(q => q.id === session.quizId);
    if (session.questionIndex + 1 >= qz.questions.length) {
      update(d => {
        d.session.status = "finished";
        d.results.unshift({ id: d.session.id, quizTitle: qz.title, date: new Date().toISOString(), participants: d.session.participants });
      });
      go("/results"); return;
    }
    update(d => { d.session.questionIndex += 1; });
    setAnswer(null); setTimeLeft(20); go("/host");
  }
  function saveQuiz(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") || "").trim();
    if (!title) return setNotice("Quiz title is required.");
    const raw = String(form.get("prompt") || "").trim();
    const options = [form.get("a"), form.get("b"), form.get("c"), form.get("d")].map(v => String(v || "").trim());
    if (!raw || options.some(o => !o)) return setNotice("Question and all four options are required.");
    const correct = Number(form.get("correct"));
    update(d => {
      let q = d.quizzes.find(x => x.id === (editQuiz?.id || activeQuizId));
      if (!q || editQuiz?.isNew) {
        q = { id: newId(), title, description: "Created in QuizForge", questions: [] };
        d.quizzes.push(q);
      } else q.title = title;
      q.questions.push({ id: newId(), prompt: raw, options, correct, seconds: Number(form.get("seconds") || 20), points: Number(form.get("points") || 100) });
      setActiveQuizId(q.id);
    });
    setEditQuiz(null); setNotice("Quiz and question saved."); go("/admin");
  }
  function deleteQuiz(id) {
    if (!confirm("Delete this quiz?")) return;
    update(d => { d.quizzes = d.quizzes.filter(q => q.id !== id); if (!d.quizzes.length) d.quizzes = []; });
    setActiveQuizId(db.quizzes.find(q => q.id !== id)?.id || ""); setNotice("Quiz deleted.");
  }
  function exportCsv() {
    const rows = [["Name","Score","Correct answers"], ...ranked.map(p => [p.name,p.score,p.answers.filter(a=>a.correct).length])];
    const csv = rows.map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "quiz-results.csv"; a.click(); URL.revokeObjectURL(url);
  }
  function certificate() {
    const w = window.open("", "_blank");
    if (!w) return setNotice("Allow pop-ups to print your certificate.");
    w.document.write(`<html><head><title>Quiz Certificate</title><style>body{font-family:Arial;text-align:center;padding:60px;border:12px solid #48e5b2;color:#111}h1{font-size:42px}p{font-size:20px}</style></head><body><h1>Certificate of Participation</h1><p>This certifies that</p><h2>${esc(myPlayer?.name || playerName || "Participant").replaceAll("<","&lt;")}</h2><p>completed the QuizForge challenge.</p><p>Rank: ${ranked.findIndex(p=>p.id===playerId)+1 || "Participant"}</p><p>${new Date().toLocaleDateString()}</p><script>window.print()<\/script></body></html>`);
    w.document.close();
  }
  const navItems = [
    ["/admin","Dashboard",LayoutDashboard],
    ["/builder","Quiz builder",ListChecks],
    ["/host","Host lobby",Radio],
    ["/join","Join quiz",Users],
    ["/leaderboard","Leaderboard",Trophy],
    ["/results","Results",Settings]
  ];
  const adminRoute = ["/admin","/builder","/host","/results"].includes(route);
  if (adminRoute && route !== "/host" && !loggedIn) return <Shell><section className="panel login-panel"><div className="brand-icon"><ShieldCheck/></div><p className="eyebrow">ADMIN ACCESS</p><h1>Welcome back</h1><p className="muted">Sign in to manage quizzes and host a session.</p><form onSubmit={login} className="stack"><label>Username<input value={loginUser} onChange={e=>setLoginUser(e.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={loginPass} onChange={e=>setLoginPass(e.target.value)} autoComplete="current-password" required /></label><button className="btn primary">Sign in <ArrowRight size={17}/></button></form><p className="hint">Demo only: username <b>admin</b>, password <b>quiz123</b>.</p><button className="btn ghost full" onClick={()=>go("/")}>Back to home</button></section></Shell>;

  return <Shell>
    <div className="layout">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="side-brand"><span className="brand-icon small"><ShieldCheck/></span><div>Quiz<span>Forge</span><small>QUIZ CONTROL CENTER</small></div><button className="icon-btn close-nav" onClick={()=>setMobileNav(false)} aria-label="Close menu"><X/></button></div>
        <p className="nav-label">WORKSPACE</p>
        {navItems.map(([path,label,Icon])=><button key={path} className={`nav-item ${route===path?"active":""}`} onClick={()=>go(path)}><Icon size={18}/>{label}</button>)}
        <div className="sidebar-bottom"><div className="online-dot"/> Local demo mode <button className="nav-item" onClick={logout}><LogOut size={18}/> Logout</button></div>
      </aside>
      <main className="main">
        <div className="mobile-top"><button className="icon-btn" onClick={()=>setMobileNav(true)} aria-label="Open menu"><Menu/></button><b>QuizForge</b><span className="pill"><span className="online-dot"/> Demo</span></div>
        <div className="topbar"><div><p className="eyebrow">QUIZ MANAGEMENT PLATFORM</p><h1>{({"/": "Welcome", "/admin":"Dashboard", "/builder":"Quiz builder", "/host":"Host console", "/join":"Join a quiz", "/play":"Participant game", "/leaderboard":"Leaderboard", "/results":"Results dashboard"})[route] || "QuizForge"}</h1></div><span className="pill"><span className="online-dot"/> Frontend prototype</span></div>
        {route === "/" && <div className="welcome-grid"><section className="panel welcome"><span className="pill">✦ INTERACTIVE QUIZZES</span><h2>Make every question<br/><span>count.</span></h2><p className="muted">Create a quiz, invite participants and see who tops the leaderboard.</p><div className="button-row"><button className="btn primary" onClick={()=>go("/login")}>Admin sign in <ArrowRight size={17}/></button><button className="btn secondary" onClick={()=>go("/join")}>Join a quiz</button></div></section><section className="panel mini-stat"><div className="stat-icon"><ListChecks/></div><p className="muted">Total quizzes</p><h2>{stats.quizzes}</h2><p className="tiny">Saved in this browser</p></section><section className="panel mini-stat"><div className="stat-icon violet"><Users/></div><p className="muted">Questions</p><h2>{stats.questions}</h2><p className="tiny">Across all quizzes</p></section></div>}
        {route === "/login" && <section className="panel narrow"><h2>Admin sign in</h2><p className="muted">Demo credentials: admin / quiz123</p><form onSubmit={login} className="stack"><label>Username<input value={loginUser} onChange={e=>setLoginUser(e.target.value)} required/></label><label>Password<input type="password" value={loginPass} onChange={e=>setLoginPass(e.target.value)} required/></label><button className="btn primary">Sign in</button></form></section>}
        {route === "/admin" && <><div className="stat-grid"><Stat icon={<ListChecks/>} label="Total quizzes" value={stats.quizzes}/><Stat icon={<Users/>} label="Questions" value={stats.questions}/><Stat icon={<Trophy/>} label="Saved result sessions" value={db.results.length}/></div><section className="panel section"><div className="section-heading"><div><h2>Your quizzes</h2><p className="muted">Create, manage and launch a quiz.</p></div><button className="btn primary" onClick={()=>{setEditQuiz({isNew:true});go("/builder")}}><Plus size={17}/> New quiz</button></div><div className="quiz-list">{db.quizzes.map(q=><article className="quiz-card" key={q.id}><div className="quiz-symbol"><ShieldCheck/></div><div className="quiz-card-info"><h3>{q.title}</h3><p className="muted">{q.questions.length} questions · {q.description}</p></div><button className="icon-btn" title="Edit quiz title and add a question" onClick={()=>{setActiveQuizId(q.id);setEditQuiz({id:q.id});go("/builder")}}><Pencil size={17}/></button><button className="icon-btn danger" title="Delete quiz" onClick={()=>deleteQuiz(q.id)}><Trash2 size={17}/></button><button className="btn secondary compact" onClick={()=>{setActiveQuizId(q.id);startSession()}}><Play size={16}/> Host</button></article>)}</div>{db.quizzes.length===0&&<p className="muted">No quizzes yet. Create your first one.</p>}</section></>}
        {route === "/builder" && <section className="panel section"><p className="eyebrow">CONTENT EDITOR</p><h2>{editQuiz?.isNew?"Create a quiz":"Add a question"}</h2><p className="muted">A quiz title and one multiple-choice question are saved together.</p><form className="stack" onSubmit={saveQuiz}><label>Quiz title<input name="title" defaultValue={editQuiz?.isNew?"":quiz?.title || ""} placeholder="e.g. Network Security" required/></label><label>Question prompt<textarea name="prompt" placeholder="Write your question..." rows="3" required/></label><div className="two-col"><label>Option A<input name="a" placeholder="First option" required/></label><label>Option B<input name="b" placeholder="Second option" required/></label><label>Option C<input name="c" placeholder="Third option" required/></label><label>Option D<input name="d" placeholder="Fourth option" required/></label></div><div className="two-col"><label>Correct option<select name="correct"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label><label>Time limit (seconds)<input name="seconds" type="number" min="5" max="180" defaultValue="20"/></label><label>Points<input name="points" type="number" min="1" max="1000" defaultValue="100"/></label></div><div className="button-row"><button className="btn primary"><Plus size={17}/> Save quiz/question</button><button type="button" className="btn ghost" onClick={()=>go("/admin")}>Cancel</button></div></form></section>}
        {route === "/host" && <section className="panel section"><div className="section-heading"><div><p className="eyebrow">HOST CONTROLS</p><h2>{session ? "Live session" : "Start a session"}</h2></div><Radio/></div>{!session || session.status==="finished" ? <><p className="muted">Select a quiz to generate a six-digit join PIN.</p><label>Select quiz<select value={activeQuizId} onChange={e=>setActiveQuizId(e.target.value)}>{db.quizzes.map(q=><option key={q.id} value={q.id}>{q.title}</option>)}</select></label><button className="btn primary top-gap" onClick={startSession} disabled={!quiz}>Create host lobby <ArrowRight size={17}/></button></> : <><div className="pin-card"><p className="muted">PARTICIPANTS JOIN WITH THIS PIN</p><strong>{session.pin}</strong><button className="btn secondary" onClick={()=>{navigator.clipboard?.writeText(session.pin);setNotice("PIN copied.")}}><Copy size={16}/> Copy PIN</button><p className="tiny">Open this same website on another tab to test joining. This prototype stores data in this browser only.</p></div><div className="section-heading top-gap"><h3>Participants ({participants.length})</h3><button className="btn ghost compact" onClick={()=>go("/join")}>Open join screen</button></div>{participants.length===0&&<p className="muted">Waiting for participants to join...</p>}<div className="participant-list">{participants.map(p=><div className="participant-row" key={p.id}><span className="avatar">{p.name.slice(0,1).toUpperCase()}</span><b>{p.name}</b><span className="muted push">{p.score} pts</span></div>)}</div>{session.status==="lobby"?<button className="btn primary full top-gap" onClick={beginGame} disabled={!participants.length}><Play size={17}/> Start game</button>:<><div className="question-host"><p className="eyebrow">QUESTION {session.questionIndex+1} / {quiz?.questions.length}</p><h3>{currentQuestion?.prompt}</h3><p className="muted">Correct answers received: {participants.filter(p=>p.answers.some(a=>a.questionId===currentQuestion?.id)).length} / {participants.length}</p></div><div className="button-row"><button className="btn secondary" onClick={()=>go("/leaderboard")}>Leaderboard</button><button className="btn primary" onClick={nextHostQuestion}>{session.questionIndex+1>=quiz?.questions.length?"Finish & results":"Reveal / Next →"}</button></div></>}</>}</section>}
        {route === "/join" && <section className="panel narrow"><div className="brand-icon"><Users/></div><p className="eyebrow">PARTICIPANT ACCESS</p><h2>Join the quiz</h2><p className="muted">Ask your host for the six-digit PIN.</p><form className="stack" onSubmit={joinSession}><label>Game PIN<input inputMode="numeric" maxLength="6" pattern="[0-9]{6}" value={joinPin} onChange={e=>setJoinPin(e.target.value.replace(/\D/g,""))} placeholder="123456" required/></label><label>Your display name<input value={playerName} onChange={e=>setPlayerName(e.target.value)} maxLength="24" placeholder="e.g. Alex" required/></label><button className="btn primary">Join game <ArrowRight size={17}/></button></form></section>}
        {route === "/play" && <section className="panel section">{!session||!myPlayer?<><h2>You're not in a session</h2><button className="btn primary" onClick={()=>go("/join")}>Join a quiz</button></>:session.status==="lobby"?<><p className="eyebrow">YOU'RE IN</p><h2>Welcome, {myPlayer.name}!</h2><p className="muted">Your host will start the quiz soon. Keep this screen open.</p><div className="waiting"><div className="spinner"/><span>Waiting for host...</span></div></>:session.status==="finished"?<><p className="eyebrow">QUIZ COMPLETED</p><h2>Well played, {myPlayer.name}!</h2><div className="result-score">{myPlayer.score}<small>POINTS</small></div><p className="muted">Your final rank: #{ranked.findIndex(p=>p.id===playerId)+1}</p><button className="btn primary" onClick={certificate}>Get certificate <Download size={17}/></button><button className="btn secondary top-gap" onClick={()=>go("/leaderboard")}>View leaderboard</button></>:currentQuestion?<><div className="quiz-top"><span>Question {session.questionIndex+1} of {quiz.questions.length}</span><span className="timer"><span className="online-dot"/>{timeLeft}s</span></div><div className="progress-track"><div id="play-progress" style={{width:`${((session.questionIndex+1)/quiz.questions.length)*100}%`}}/></div><h2 className="player-question">{currentQuestion.prompt}</h2><div className="options">{currentQuestion.options.map((opt,i)=><button disabled={answer!==null} className={`option-btn ${answer!==null&&i===currentQuestion.correct?"correct":answer===i?"wrong":""}`} key={opt} onClick={()=>submitAnswer(i)}><span>{String.fromCharCode(65+i)}</span>{opt}</button>)}</div>{answer!==null&&<div className="feedback-box"><b>{answer===currentQuestion.correct?"Correct answer!":"Answer submitted"}</b><p>{currentQuestion.options[currentQuestion.correct]}</p><p className="muted">Waiting for host to reveal the next question. Your score: {myPlayer.score} points.</p></div>}</>:<p>Loading question...</p>}</section>}
        {route === "/leaderboard" && <section className="panel section"><div className="section-heading"><div><p className="eyebrow">LIVE RANKINGS</p><h2>Leaderboard</h2></div><Trophy/></div>{ranked.length===0?<p className="muted">No participants yet. Create a lobby and invite players.</p>:<><div className="leader-list">{ranked.slice(0,10).map((p,i)=><div className="leader-row" key={p.id}><span className={`rank rank-${i+1}`}>{i+1}</span><span className="avatar">{p.name.slice(0,1).toUpperCase()}</span><b>{p.name}</b><span className="push score-text">{p.score} pts</span></div>)}</div><button className="btn secondary top-gap" onClick={exportCsv}><Download size={17}/> Export CSV</button></>}</section>}
        {route === "/results" && <section className="panel section"><div className="section-heading"><div><p className="eyebrow">SESSION SUMMARY</p><h2>Results dashboard</h2></div><button className="btn secondary compact" onClick={exportCsv}><Download size={16}/> CSV</button></div>{db.results.length===0?<p className="muted">Finished quiz sessions will appear here.</p>:db.results.map(r=><div className="result-session" key={r.id}><h3>{r.quizTitle}</h3><p className="muted">{new Date(r.date).toLocaleString()} · {r.participants.length} participants</p>{[...r.participants].sort((a,b)=>b.score-a.score).map((p,i)=><div className="participant-row" key={p.id}><span className="rank">{i+1}</span><b>{p.name}</b><span className="push score-text">{p.score} pts</span></div>)}</div>)}{session?.status==="finished"&&<button className="btn secondary top-gap" onClick={certificate}>Download certificate <Download size={17}/></button>}</section>}
        <div className="footer-note"><ShieldCheck size={15}/> Built for learning · Keep your systems secure</div>
      </main>
    </div>
    {mobileNav&&<button className="scrim" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}
    {notice&&<div className="toast" role="status">{notice}</div>}
  </Shell>;
}
function Stat({icon,label,value}) { return <section className="panel stat"><div className="stat-icon">{icon}</div><p className="muted">{label}</p><strong>{value}</strong></section>; }
function Shell({children}) { return <div className="site-shell">{children}</div>; }
export default App;
