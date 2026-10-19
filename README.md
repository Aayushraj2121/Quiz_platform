# GLITCH IN REALITY

## Backend development

The backend service is in `apps/game-server` and uses TypeScript, Express,
Prisma, and SQLite for local development.

### Requirements

- Node.js 20 or newer
- npm

### Setup

```bash
cd apps/game-server
npm install
cp .env.example .env
```

Set `DATABASE_URL` in `.env` to a SQLite URL such as
`file:./prisma/dev.db`. The seed admin is created only when both
`SEED_ADMIN_USERNAME` and `SEED_ADMIN_PASSWORD` are set.

### Database commands

Generate the Prisma client:

```bash
npm run db:generate
```

Create and apply a development migration:

```bash
npm run db:migrate -- --name init
```

Apply committed migrations in a deployment environment:

```bash
npm run db:deploy
```

Run the repeatable development seed:

```bash
npm run db:seed
```

The seed upserts a local development administrator when configured and a
sample quiz with one question and three options. It never stores a plaintext
password; the configured seed password is hashed before persistence.

### Run and verify

```bash
npm run typecheck
npm run build
npm test
npm run dev
```

The health endpoint is available at `GET /api/health`.

SQLite files, uploads, local environment files, dependencies, and build
outputs are ignored by Git. Production deployments require persistent storage
and backups for SQLite and uploaded media.

## Stage 4 API

Admin management endpoints require `Authorization: Bearer <token>`. Obtain a
token with:

```bash
curl -X POST http://127.0.0.1:4000/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your-password"}'
```

Implemented protected endpoints:

- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/quizzes?page=1&pageSize=20`
- `POST /api/quizzes`
- `GET /api/quizzes/:id`
- `PATCH /api/quizzes/:id`
- `DELETE /api/quizzes/:id`
- `GET /api/questions/quiz/:id`
- `POST /api/questions/quiz/:id`
- `GET /api/questions/:id`
- `PATCH /api/questions/:id`
- `DELETE /api/questions/:id`
- `POST /api/questions/:id/options`
- `PATCH /api/questions/options/:id`

Question creation and replacement updates require 2–4 options and exactly one
correct option. Timer values are restricted to 10–120 seconds. Correct-answer
flags are returned only from these admin-protected management endpoints; no
participant/public API is exposed in this stage.

Login is rate limited to 10 attempts per 15 minutes per client window. JWTs
are signed with `JWT_SECRET` and expire after eight hours. Logout is stateless:
the client must discard its token. A future token revocation mechanism can be
added if required by the deployment model.

## Stage 5 API

Session administration requires the same admin bearer token:

- `POST /api/sessions` with `{"quizId":"<published-quiz-id>"}`
- `GET /api/sessions?page=1&pageSize=20`
- `GET /api/sessions/:id`
- `PATCH /api/sessions/:id/status` with `{"status":"QUESTION"}`

Only published quizzes with at least one valid question can create a session.
Each session receives a unique six-digit numeric PIN. Valid administrative
status transitions are enforced by the `SessionStatus` state machine; this
stage does not start timers or gameplay.

Participants join a lobby publicly:

```bash
curl -X POST http://127.0.0.1:4000/api/sessions/join/123456 \
  -H 'Content-Type: application/json' \
  -d '{"displayName":"Alice","email":"alice@example.com","studentId":"S-1"}'
```

The join response contains only the session's public ID/PIN/status/quiz title
and the joining participant's safe fields. Display names are unique within a
session and concurrent duplicate joins are rejected by the database constraint.
There is no configured participant-limit field in the current schema, so no
limit is enforced in this stage. Join attempts are rate limited to 30 per
15-minute client window.

## Stage 6 Socket.IO API

The realtime server is attached to the same HTTP server as the REST API. Local
clients connect to `http://127.0.0.1:4000` with a Socket.IO authentication
handshake:

```ts
io("http://127.0.0.1:4000", {
  auth: { role: "host", token: adminJwt }
});

io("http://127.0.0.1:4000", {
  auth: { role: "participant", token: connectionToken }
});
```

The participant `connectionToken` is issued by the successful Stage 5 join
response. It is a signed JWT valid for 24 hours and is also stored only as a
SHA-256 hash on the participant record. The server verifies the token claims,
session association, participant existence, and stored hash on every socket
connection. The token is not placed in URLs or logs. A future revocation
mechanism can invalidate tokens by clearing/changing the stored hash.

Client-to-server events:

| Event | Payload | Ack | Authorization |
| --- | --- | --- | --- |
| `host:join` | `{sessionId}` | safe session state | host JWT |
| `host:start-question` | `{sessionId, questionIndex}` | safe question | joined host |
| `host:reveal-answer` | `{sessionId}` | success/error | joined host |
| `host:advance-state` | `{sessionId, questionIndex?, endGame?}` | state/error | joined host |
| `participant:join-game` | `{sessionId}` | safe state | matching participant token |
| `participant:reconnect` | `{sessionId}` | safe state | matching participant token |
| `participant:submit-answer` | `{sessionId, questionId, optionId}` | receipt only | matching participant token |

Server-to-client events are `connection:ready`, `session:state`,
`participant:joined`, `participant:count`, `question:started`,
`question:timer`, `question:ended`, `answer:received`, `answer:revealed`, and
`session:error`. Question broadcasts contain only option IDs and text;
correctness is never sent before `answer:revealed`. Answer acknowledgements
contain only acceptance and server timestamp, not correctness or score.

Question deadlines are generated by the server from the stored question timer.
The server rejects late answers, duplicate answers, invalid question/option
relationships, and commands for sessions that are not in a valid state. Timer
resources are cleared on reveal, advance, end-game, and server shutdown.
Timers are intentionally in-memory for this single-process implementation.
After a process restart, an interrupted `QUESTION` session has no surviving
timer; an authorized host must explicitly reveal, advance, or end the session.
Do not deploy multiple game-server instances without shared realtime state.
