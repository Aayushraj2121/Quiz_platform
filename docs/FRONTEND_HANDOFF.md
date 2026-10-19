# GLITCH IN REALITY frontend handoff

This document describes the contracts implemented by `apps/game-server`. The backend is a single-process service: active timers and Socket.IO state live in memory and are not shared across instances.

## Local startup

```bash
cp apps/game-server/.env.example apps/game-server/.env
# Set a random JWT_SECRET with at least 32 characters.
npm --prefix apps/game-server install
DATABASE_URL="file:./dev.db" npm --prefix apps/game-server run db:deploy
DATABASE_URL="file:./dev.db" npm --prefix apps/game-server run db:seed
npm --prefix apps/game-server run dev
```

Required runtime values are `DATABASE_URL` and `JWT_SECRET`. Frontend/browser integration normally uses `CORS_ORIGINS`, `PUBLIC_APP_URL`, and the upload settings in `.env`.

## REST

All JSON responses use `{ "success": true, "data": ... }`. Errors use `{ "success": false, "error": { "code": "...", "message": "..." } }`.

Admin endpoints require `Authorization: Bearer <admin JWT>`. Admin JWTs expire after seven days. Participant connection tokens returned by joining also expire after seven days and are bound to one participant and session.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | None | Health check |
| POST | `/api/admin/login` | None | Login with `{ username, password }` |
| GET | `/api/admin/me` | Admin | Current admin identity |
| POST | `/api/admin/logout` | Admin | Stateless logout; discard the token client-side |
| GET/POST | `/api/quizzes` | Admin | List or create quizzes |
| GET/PATCH/DELETE | `/api/quizzes/:id` | Admin | Retrieve, update, or delete a quiz |
| GET/POST | `/api/questions/quiz/:id` | Admin | List or create questions for a quiz |
| GET/PATCH/DELETE | `/api/questions/:id` | Admin | Retrieve, update, or delete a question |
| POST | `/api/questions/:id/options` | Admin | Create an answer option |
| PATCH | `/api/questions/options/:id` | Admin | Update an answer option |
| POST | `/api/sessions` | Admin | Create a session for an eligible published quiz |
| GET | `/api/sessions` | Admin | Paginated session list |
| GET | `/api/sessions/:id` | Admin | Session detail |
| PATCH | `/api/sessions/:id/status` | Admin | Validated session status update |
| POST | `/api/sessions/join/:pin` | None | Join a lobby with `{ displayName, email?, studentId? }`; duplicate names receive `(1)`, `(2)`, etc. |
| GET | `/api/sessions/:id/leaderboard` | Admin or participant token | Safe leaderboard |
| GET | `/api/results/:sessionId` | Admin or participant token | Full admin result or participant-private result |
| GET | `/api/results/:sessionId/export` | Admin | Summary CSV; add `?detail=1` for answer-level rows |
| GET | `/api/results/sessions/:sessionId/export.csv` | Admin | Compatibility alias for CSV export |
| POST | `/api/media/questions/:questionId` | Admin multipart | Upload `file`; images are limited to 10 MB and videos to 100 MB |
| GET | `/api/media/:assetId` | None | Serve a validated stored media asset |
| DELETE | `/api/media/:assetId` | Admin | Delete an asset |
| GET | `/api/cert/:participantToken` | Participant token in path | Issue or retrieve the participant certificate after podium/end |
| GET | `/api/cert/verify/:verificationCode` | None | Verify a certificate |

Quiz, question, option, session, and upload validation is performed with Zod. Correct-answer fields are not included in safe gameplay question payloads.

## Socket.IO

Connect to the same origin with `auth: { token, role }`, where `role` is `host` for an admin JWT or `participant` for a participant connection token. Join a room before gameplay:

```ts
host.emit("host:join", { sessionId }, ack);
participant.emit("participant:join-game", { sessionId }, ack);
participant.emit("participant:reconnect", { sessionId }, ack);
```

Host commands:

- `host:start-question` `{ sessionId, questionIndex }`
- `host:reveal` or `host:reveal-answer` `{ sessionId }`
- `host:extend` `{ sessionId, seconds: 10 }`
- `host:leaderboard` `{ sessionId }`
- `host:advance-state` `{ sessionId, questionIndex? , endGame? }`
- `host:end` `{ sessionId }`

Participant command:

- `participant:submit-answer` `{ sessionId, questionId, optionId }`

Server events to handle:

- Connection/state: `connection:ready`, `session:state`, `session:error`
- Lobby: `participant:joined`, `participant:count`
- Gameplay: `question:started` (and compatibility alias `question:start`), `question:timer`, `question:progress`, `question:ended`, `answer:received`
- Reveal/scoring: `answer:revealed`, `reveal`, `reveal:personal`
- Results/lifecycle: `leaderboard`, `leaderboard:updated`, `podium`, `game:ended`

Safe question payloads contain question text, public option IDs/text, timer/deadline, explanation, and optional `mediaAssetId`; they never contain `isCorrect`. The `reveal` event is the first event containing `correctOptionId`. `reveal:personal` is sent only to the matching participant socket.

## Session lifecycle

The persisted states are `LOBBY -> QUESTION -> REVEAL -> LEADERBOARD`, repeating for each question, then `PODIUM -> ENDED` for the final lifecycle. A timer changes `QUESTION` to `REVEAL`; automatic flow then publishes the leaderboard and advances without requiring a host socket to remain connected. Host commands are still required to start the initial question and may manually reveal, extend, advance, or end.

## Scoring and privacy

Scoring is server-authoritative. Correct answers use `round(basePoints * (0.5 + 0.5 * remainingTime / timeLimit))`; streak bonus begins on the third consecutive correct answer, adds 100 per additional correct answer, and caps at 500. Incorrect and unanswered questions score zero and reset the streak. Leaderboards order by total score, correct count, earlier join time, and a stable identifier.

Participant result responses omit email/student ID and other participants' answer histories. Admin result responses and CSV exports include the authorized session's participant and answer data.

## Common failures

Clients should handle `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409` conflict/duplicate errors, `400` validation/state errors, `413 MEDIA_TOO_LARGE`, `429 RATE_LIMITED`, `TOO_LATE`, `ALREADY_ANSWERED`, and `INVALID_OPTION`. Socket acknowledgements use the same `{ success, error?, data? }` shape as REST.
