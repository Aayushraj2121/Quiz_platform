# GLITCH IN REALITY — End-to-End Test Cases

This checklist is the merge gate for the backend and frontend branches. It
covers the live quiz flow described by the PRD and the contracts implemented in
`docs/FRONTEND_HANDOFF.md`.

## Test environment

Use a disposable SQLite database and a local single-process server:

```bash
export DATABASE_URL="file:/tmp/glitch-e2e.db"
export JWT_SECRET="local-e2e-secret-that-is-at-least-32-characters"
export PORT=4000
export CORS_ORIGINS="http://127.0.0.1:5173,http://localhost:5173"
export PUBLIC_APP_URL="http://127.0.0.1:5173"

npm --prefix apps/game-server run db:deploy
npm --prefix apps/game-server run db:seed
npm --prefix apps/game-server run dev
npm --prefix apps/web run dev
```

Use a fresh database for each complete run. Do not point E2E tests at a
developer's normal database. The seeded local admin is `admin` / `admin`.
Replace this password in any shared or deployed environment.

## Test data

Create or use:

- One published quiz with at least three questions.
- Question 1: two options, one correct answer, 30-second timer, 1,000 points.
- Question 2: three options, one correct answer, 10-second timer, 500 points.
- Question 3: an image or video asset, one correct answer, 30-second timer.
- At least two participant browser contexts: Alice and Bob.
- One invalid or expired admin token and one invalid participant token.

Record the generated session ID, six-digit PIN, participant connection tokens,
question IDs, certificate verification code, and uploaded asset ID during the
run. Never include JWTs in screenshots, logs, or test reports.

## Priority and result values

- **P0** — blocks merging; core login, joining, gameplay, scoring, or data
  isolation is broken.
- **P1** — required PRD behavior is broken but has a workaround.
- **P2** — non-critical UX or documentation issue.

Each case should be recorded as `PASS`, `FAIL`, or `BLOCKED`, with browser,
commit, database, and server logs attached for failures.

## A. Startup, health, and configuration

| ID | Pri | Scenario | Steps | Expected result |
|---|---:|---|---|---|
| E2E-001 | P0 | Backend starts with documented local configuration | Start the server using the environment above. | Server starts without secrets in logs; no migration or runtime error. |
| E2E-002 | P0 | Frontend starts against backend | Start Vite with `VITE_API_URL` and `VITE_SOCKET_URL`. | Join page loads and no API/CORS error appears in the browser console. |
| E2E-003 | P0 | Health endpoint | `GET /api/health`. | HTTP 200 and success response. |
| E2E-004 | P1 | Missing required configuration | Start without `DATABASE_URL` or with a short `JWT_SECRET`. | Startup fails clearly and does not start an insecure server. |
| E2E-005 | P1 | Responsive layout | Open the join page at desktop, tablet, and mobile widths. | No horizontal overflow; join, admin, lobby, question, leaderboard, and results views remain usable. |

## B. Admin authentication and authorization

| ID | Pri | Scenario | Steps | Expected result |
|---|---:|---|---|---|
| E2E-010 | P0 | Successful admin login | Open host console; submit `admin` / `admin`. | Control room opens; token is held client-side only; password and token are not rendered. |
| E2E-011 | P0 | Admin identity | Call `GET /api/admin/me` with the login token. | HTTP 200; identity contains no password hash or secret. |
| E2E-012 | P0 | Invalid credentials | Submit an incorrect password and an unknown username. | Safe authentication error; no distinction that leaks whether a username exists. |
| E2E-013 | P0 | Missing, malformed, and expired token | Call an admin endpoint with no token, malformed token, and expired token. | HTTP 401 with the standard error envelope. |
| E2E-014 | P0 | Participant cannot use admin token incorrectly | Use a participant token on an admin REST endpoint or host Socket.IO room. | Request is rejected with 401/403; no admin data is returned. |
| E2E-015 | P1 | Login rate limiting | Send repeated failed logins from one client. | Rate limit returns HTTP 429; response does not reveal credentials or implementation details. |
| E2E-016 | P1 | Logout behavior | Log out, then discard the token and call an admin endpoint. | Client returns to login; discarded token is no longer used by the frontend. |

## C. Quiz and question authoring

| ID | Pri | Scenario | Steps | Expected result |
|---|---:|---|---|---|
| E2E-020 | P0 | Create quiz | In Quizzes, create a title and description. | Quiz appears as `DRAFT` with a stable ID and timestamps. |
| E2E-021 | P0 | Publish eligible quiz | Add valid questions, then publish. | Quiz becomes `PUBLISHED`; it is available in session creation. |
| E2E-022 | P0 | Reject invalid question | Submit empty text, fewer than two options, or no/multiple correct options. | Validation error; no partial question is created. |
| E2E-023 | P0 | Question ordering | Add three questions in order, reload the quiz, and add another. | Orders are unique, predictable, and displayed in the intended sequence. |
| E2E-024 | P1 | Update and delete question | Update text/options; delete a question. | Changes persist; deletion does not leave orphaned answer options or break order handling. |
| E2E-025 | P1 | Quiz isolation | Attempt to retrieve or modify another quiz/question ID with an admin token. | Only permitted resources are returned or changed; invalid IDs produce safe 404/403 errors. |
| E2E-026 | P1 | Correct-answer privacy | Inspect quiz APIs used by participants and Socket.IO `question:started`. | Public/gameplay payloads never contain `isCorrect` or answer keys before reveal. |

## D. Media lifecycle

| ID | Pri | Scenario | Steps | Expected result |
|---|---:|---|---|---|
| E2E-030 | P0 | Upload valid image | Upload a valid PNG/JPEG to a question from the admin UI. | Asset is associated with the question and appears in the authoring view. |
| E2E-031 | P0 | Upload valid video | Upload a valid MP4/WebM within the configured limit. | Upload succeeds and the participant question view can render it if supported by the UI. |
| E2E-032 | P0 | Reject invalid media | Upload an executable, renamed unsupported file, malformed signature, or oversized file. | Upload is rejected with the documented error; no unsafe file is served. |
| E2E-033 | P0 | Path traversal protection | Use filenames containing `../`, absolute paths, quotes, and Unicode. | Server generates a safe storage name; file remains inside `UPLOAD_DIR`. |
| E2E-034 | P1 | Replace and delete media | Upload a replacement, then delete the asset. | Old asset is no longer associated/servable; no unrelated asset is deleted. |
| E2E-035 | P1 | Media authorization | Try upload/delete with no token, participant token, and another admin context. | Unauthorized operations are rejected; serving exposes only the intended asset fields. |

## E. Session creation and QR participant joining

| ID | Pri | Scenario | Steps | Expected result |
|---|---:|---|---|---|
| E2E-040 | P0 | Create lobby | Select the published quiz and create a session. | Session is `LOBBY`, has a unique six-digit PIN, and appears in Sessions. |
| E2E-041 | P0 | QR encodes current session | Open Host or Sessions and scan/read the QR value. | Value is `<frontend-origin>/?pin=<session-pin>`; it contains the current six-digit PIN only. |
| E2E-042 | P0 | QR opens participant join page | Open the QR URL in a new browser context. | Join page loads with the PIN prefilled; display name is empty and ready for input. |
| E2E-043 | P0 | Edit QR-prefilled PIN | Change one digit or replace the PIN manually, then submit. | Input remains editable; join uses the edited value, not the original QR value. |
| E2E-044 | P0 | Valid PIN join | Join as Alice with the session PIN. | HTTP 200; safe participant/session fields and a connection token are returned; no admin data or answer keys. |
| E2E-045 | P0 | Invalid or closed join | Try an unknown PIN, ended session, and non-joinable state. | Safe 404/409/400 response; participant is not created. |
| E2E-046 | P0 | Duplicate display names | Join Alice twice and join Bob with Alice's display name. | Names follow the documented suffix rule (`Alice`, `Alice (1)`, etc.) without exposing private identifiers. |
| E2E-047 | P1 | Concurrent joins | Submit more join requests than the supported limit concurrently. | No duplicate participant identity records or limit overrun; each response is deterministic and safe. |
| E2E-048 | P1 | Session isolation | Use a participant token or PIN from session A against session B endpoints/events. | Request/socket action is rejected; session B data is not disclosed. |

## F. Socket.IO authorization and lobby

| ID | Pri | Scenario | Steps | Expected result |
|---|---:|---|---|---|
| E2E-050 | P0 | Host joins session room | Connect host with admin JWT and emit `host:join`. | Ack succeeds only for an authorized session; host receives safe `session:state`. |
| E2E-051 | P0 | Participant joins room | Connect Alice and Bob with their connection tokens; emit `participant:join-game`. | Both receive `connection:ready`/state and lobby participant counts update. |
| E2E-052 | P0 | Unauthorized room join | Use invalid, expired, or cross-session socket credentials. | Connection or room join is rejected with the standard error shape. |
| E2E-053 | P1 | Lobby refresh | Refresh Alice's browser before the first question. | Reconnects to the same participant/session without creating a second participant. |
| E2E-054 | P1 | Lobby disconnect | Disconnect Bob and reconnect him before start. | Count/state recover without corrupting the lobby. |

## G. Gameplay, timer, and host controls

| ID | Pri | Scenario | Steps | Expected result |
|---|---:|---|---|---|
| E2E-060 | P0 | Start first question | Host emits `host:start-question` for question 0. | State becomes `QUESTION`; clients receive safe question text/options, deadline, and timer. |
| E2E-061 | P0 | Correct answer | Alice selects the correct option before timeout. | Answer is accepted once; no correctness is revealed to other participants before reveal. |
| E2E-062 | P0 | Incorrect answer | Bob selects an incorrect option. | Answer is accepted once and scores zero after finalization. |
| E2E-063 | P0 | Duplicate answer | Submit two answer events from Alice for the same question. | First valid answer is used; second returns `ALREADY_ANSWERED` or equivalent and adds no points. |
| E2E-064 | P0 | Invalid option/question | Submit an option from another question or a fabricated option ID. | Rejected with `INVALID_OPTION`; no score or answer record is created. |
| E2E-065 | P0 | Timer expiry | Submit after the deadline or let the timer expire. | Late answer returns `TOO_LATE`; question finalizes once and unanswered streaks reset. |
| E2E-066 | P0 | Manual reveal | Host emits `host:reveal`. | State becomes `REVEAL`; `correctOptionId` appears only in reveal events. |
| E2E-067 | P1 | Timer extension | Host extends the active timer. | New deadline is broadcast; no duplicate finalization timer remains. |
| E2E-068 | P1 | Leaderboard transition | Host requests leaderboard after reveal. | State becomes `LEADERBOARD`; all entries are deterministic and safe. |
| E2E-069 | P1 | Automatic progression | Keep host socket disconnected after question start/reveal. | Timer and automatic progression still complete according to the documented single-process behavior. |
| E2E-070 | P0 | Invalid host transition | Reveal in lobby, advance from an invalid state, or end twice. | Command is rejected safely; persisted and broadcast state remains valid. |

## H. Scoring, rankings, and reconnect

| ID | Pri | Scenario | Steps | Expected result |
|---|---:|---|---|---|
| E2E-080 | P0 | Base-point/time scoring | Answer the same question at different remaining times. | Server calculates `round(basePoints * (0.5 + 0.5 * remaining/timeLimit))`; client values are ignored. |
| E2E-081 | P0 | Streak bonus | Give Alice three consecutive correct answers, then an incorrect answer. | Bonus starts on the third correct answer, caps as documented, and incorrect/unanswered resets the streak. |
| E2E-082 | P0 | Deterministic ties | Create equal scores and correct counts. | Ranking uses earlier join time, then stable identifier; repeated result requests preserve order. |
| E2E-083 | P0 | Participant reconnect during question | Disconnect Alice during an active question, reconnect with her token. | Alice receives the current safe question/deadline and cannot answer twice. |
| E2E-084 | P0 | Host reconnect during gameplay | Disconnect host during lobby, question, reveal, and leaderboard; reconnect. | Authorized host receives the current state and controls; no answer key leaks during question state. |
| E2E-085 | P1 | Server restart limitation | Restart the single server during a live question. | Limitation is documented; no false multi-instance/recovery claim is made, and authorized recovery behavior is verified. |

## I. End game, results, certificates, and exports

| ID | Pri | Scenario | Steps | Expected result |
|---|---:|---|---|---|
| E2E-090 | P0 | Finish final question | Complete reveal, leaderboard, and final progression. | Session emits `podium`, then `game:ended`; persisted state becomes `ENDED`. |
| E2E-091 | P0 | Podium and final results | Observe Alice and Bob clients after game end. | Podium order matches deterministic ranking; each participant sees only their own private result fields. |
| E2E-092 | P0 | Admin results | Open Results for the session as admin. | Full authorized leaderboard, participant summaries, and question statistics are shown. |
| E2E-093 | P0 | Participant result isolation | Request results with Alice's token and attempt another participant/session. | Alice receives only her own private data; cross-session/participant access is rejected. |
| E2E-094 | P0 | Summary CSV | Download the authorized summary export. | Stable headers/order, correct rows, RFC 4180 escaping, no unrelated session data. |
| E2E-095 | P1 | Detail CSV escaping | Use names/questions containing commas, quotes, and newlines; download detail CSV. | Values are correctly quoted/escaped and remain parseable. |
| E2E-096 | P0 | Certificate issuance | Request Alice's certificate after podium/end. | Certificate is issued or retrieved idempotently with a secure verification code and safe event/participant fields. |
| E2E-097 | P0 | Certificate verification | Verify the code publicly; try an unknown code. | Valid code returns safe certificate details; unknown/revoked code returns safe not-found response. |
| E2E-098 | P1 | Certificate repeat request | Request the same certificate multiple times. | Same certificate/code is returned; no duplicate certificates are created. |

## J. Security and privacy regression

| ID | Pri | Scenario | Steps | Expected result |
|---|---:|---|---|---|
| E2E-100 | P0 | Correct answers remain private | Inspect REST, Socket.IO, browser state, and network payloads before reveal. | No `isCorrect`, `correctOptionId`, answer key, admin password, JWT secret, or other participant private IDs appear. |
| E2E-101 | P0 | Session authorization | Swap session IDs in admin, participant, REST, and socket requests. | Access is denied consistently; no cross-session data is returned. |
| E2E-102 | P1 | Input validation | Send oversized names, malformed IDs, invalid order/timer/points, and unexpected JSON fields. | Zod validation rejects invalid input with standard safe errors. |
| E2E-103 | P1 | Sensitive logging | Review server logs during login, join, upload, and gameplay. | Passwords, JWTs, connection tokens, and private participant fields are absent. |
| E2E-104 | P1 | Dependency/artifact hygiene | Inspect tracked files after build/test. | No `.env`, SQLite DB, upload directory, `node_modules`, or build artifacts are committed. |

## Merge gate

Do not merge the backend and frontend branches until:

1. All P0 cases pass against the same commit set intended for merge.
2. P1 cases pass or have an explicitly approved deviation documented in the
   PR description.
3. Backend tests, frontend typecheck/build, Prisma validation, and
   `git diff --check` pass.
4. At least one real two-client gameplay run covers join, question, answer,
   reveal, leaderboard, podium, results, and certificate flow.
5. QR-join cases E2E-041 through E2E-043 pass on the deployed/local frontend
   origin that will be used by participants.
6. The final diff contains no secrets or generated artifacts.

Current repository automation covers backend health, database, authentication
and quiz APIs, sessions, scoring, and Socket.IO gameplay in
`apps/game-server/tests`. The cases above that involve two browser clients,
QR scanning, responsive layout, media rendering, CSV downloads, and full
certificate/UI flow still require browser-level execution or an approved
Playwright/Cypress suite; they should not be marked passed from unit tests
alone.
