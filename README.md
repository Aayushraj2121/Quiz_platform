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
