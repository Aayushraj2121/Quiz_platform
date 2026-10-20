# GLITCH IN REALITY

GLITCH IN REALITY is a live quiz game for classrooms, events, and teams.

One person acts as the **host**. The host creates a quiz, starts a game, and
controls the questions. Everyone else joins from a phone or computer using a
short game PIN, answers in real time, and sees the leaderboard and final
results.

This repository contains both sides of the application:

- **Admin control room** — create quizzes, add questions, upload media, launch
  games, control the live session, and view results.
- **Participant experience** — join with a PIN or QR code, answer questions,
  see reveals and leaderboards, and view final results.
- **Game server** — stores quiz data, protects admin actions, runs the live
  game, calculates scores, and sends real-time updates.

## What the finished app can do

### For the host

1. Sign in to the admin control room.
2. Create a quiz and add two to four answer choices per question.
3. Mark exactly one answer as correct.
4. Set the question timer and optionally upload an image or video.
5. Publish the quiz.
6. Start a game session.
7. Show the generated PIN or QR code to participants.
8. Start questions, reveal answers, extend timers, advance the game, and end
   the session.
9. Review the leaderboard, results, CSV export, and certificates.

### For participants

1. Open the participant page.
2. Enter the six-digit PIN, or scan the host's QR code.
3. Enter a display name.
4. Answer each question before the timer ends.
5. See the answer reveal, score, leaderboard, podium, and final result.

Duplicate display names are made unique automatically, for example
`Alex`, `Alex (1)`, and `Alex (2)`.

## Quick start for a local computer

### What you need

- Node.js 20 or newer
- npm

The application uses PostgreSQL through Supabase. You can run the web app and
game server locally while using a Supabase development project as the shared
database.

### 1. Download the project

```bash
git clone https://github.com/Aayushraj2121/Quiz_platform.git
cd Quiz_platform
```

### 2. Install the game server

```bash
cd apps/game-server
npm install
cp .env.example .env
```

Open `apps/game-server/.env` and add your Supabase connection strings and local
admin login. For example:

```dotenv
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=admin
JWT_SECRET=use-a-long-random-secret-with-at-least-32-characters
DATABASE_URL=postgresql://postgres:password@db.project-ref.supabase.co:5432/postgres
DIRECT_URL=postgresql://postgres:password@db.project-ref.supabase.co:5432/postgres
CORS_ORIGINS=http://localhost:5173
PUBLIC_APP_URL=http://localhost:5173
```

The example uses `admin`/`admin` only for a disposable local installation.
Choose a stronger password anywhere else. The CORS and public URL values above
match Vite's usual local port.

### 3. Create the local database

Run these commands from `apps/game-server`:

```bash
npm run db:generate
npm run db:deploy
npm run db:seed
```

The migration creates the tables in Supabase. The seed creates the configured
admin account and a small sample quiz.
It safely updates existing development seed data instead of creating a new
duplicate every time.

### 4. Install and configure the web app

Open a second terminal at the repository root:

```bash
cd apps/web
npm install
cp .env.example .env
```

The default web settings already point to the local game server:

```dotenv
VITE_API_URL=http://127.0.0.1:4000/api
VITE_SOCKET_URL=http://127.0.0.1:4000
```

### 5. Start both parts

In the first terminal, from `apps/game-server`:

```bash
npm run dev
```

In the second terminal, from `apps/web`:

```bash
npm run dev
```

Open the URL shown by Vite, usually
[`http://localhost:5173`](http://localhost:5173).

- Choose **Admin** to open the control room.
- Choose **Join game** to enter as a participant.
- The server health check is available at
  [`http://127.0.0.1:4000/api/health`](http://127.0.0.1:4000/api/health).

## A simple first-use walkthrough

1. Open the web app and choose **Admin**.
2. Sign in with the username and password from
   `apps/game-server/.env`.
3. Create a quiz.
4. Add at least one question, two to four options, and one correct option.
5. Publish the quiz.
6. Create a session from the published quiz.
7. Open the participant page in another browser window or on a phone.
8. Enter the displayed PIN, or scan the QR code.
9. Join with a name.
10. Return to the host control room and start the question.

## Useful links and screens

| Purpose | Location |
| --- | --- |
| Participant and host web app | `apps/web` |
| Game server | `apps/game-server` |
| Frontend/backend integration contract | [`docs/FRONTEND_HANDOFF.md`](docs/FRONTEND_HANDOFF.md) |
| End-to-end test cases | [`docs/E2E_TEST_CASES.md`](docs/E2E_TEST_CASES.md) |
| Latest test report | [`docs/E2E_TEST_REPORT.md`](docs/E2E_TEST_REPORT.md) |
| Render deployment blueprint | [`render.yaml`](render.yaml) |
| Database schema | `apps/game-server/prisma/schema.prisma` |
| Backend environment template | `apps/game-server/.env.example` |
| Frontend environment template | `apps/web/.env.example` |

## Privacy and safety basics

- Admin passwords are stored as hashes, never as plain text.
- Admin routes require a signed authentication token.
- Participant tokens are checked against the participant's session.
- Correct answers are not sent to participants before the reveal.
- Scores, ranks, and correctness are calculated by the server.
- Uploaded media receives generated filenames; the original filename is not
  used as a storage path.
- `.env` files, local databases, uploads, dependencies, and build output are
  ignored by Git. Do not commit them.

## Configuration

The backend reads configuration from `apps/game-server/.env`:

| Variable | Purpose | Local default |
| --- | --- | --- |
| `PORT` | Backend port | `4000` |
| `HOST` | Backend host | `127.0.0.1` |
| `DATABASE_URL` | Supabase pooled PostgreSQL URL used by the app | Supabase pooler URL |
| `DIRECT_URL` | Supabase direct PostgreSQL URL used by Prisma migrations | Supabase direct URL |
| `JWT_SECRET` | Secret used to sign tokens | Must be replaced |
| `CORS_ORIGINS` | Allowed web-app origins | `http://localhost:5173` |
| `UPLOAD_DIR` | Uploaded media folder | `./uploads` |
| `PUBLIC_APP_URL` | URL encoded in join links and QR codes | `http://localhost:5173` |
| `SEED_ADMIN_USERNAME` | Development admin username | `admin` |
| `SEED_ADMIN_PASSWORD` | Development admin password | Must be replaced |

Upload limits can be adjusted with `MAX_UPLOAD_BYTES`,
`MAX_IMAGE_UPLOAD_BYTES`, and `MAX_VIDEO_UPLOAD_BYTES`. JSON request size can
be adjusted with `MAX_JSON_BODY_SIZE`.

The frontend reads configuration from `apps/web/.env`:

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Backend REST URL, including `/api` |
| `VITE_SOCKET_URL` | Backend origin used for Socket.IO |

## Database commands

Run these from `apps/game-server`:

```bash
npm run db:generate   # Generate the Prisma client
npm run db:migrate    # Create a development migration
npm run db:deploy     # Apply committed migrations
npm run db:seed       # Seed/update local development data
```

The main database models include administrators, quizzes, questions, answer
options, live game sessions, participants, answers, certificates, and media
assets.

## Supabase setup

Create a project at [supabase.com](https://supabase.com), then open
**Project Settings → Database → Connect**.

Copy two PostgreSQL connection strings:

1. Use the **transaction pooler URL** as `DATABASE_URL`. Keep the
   `pgbouncer=true` parameter when Supabase provides it.
2. Use the **direct/session URL** as `DIRECT_URL`. Prisma uses this connection
   for migrations and schema changes.

Keep both URLs private. Replace the password placeholder with the database
password from Supabase. Do not commit them or put them in frontend variables.

From `apps/game-server`, apply the schema and create the first administrator:

```bash
npm install
npm run db:generate
npm run db:deploy
npm run db:seed
```

This repository's initial migration is PostgreSQL-based and is intended for a
new Supabase database. Existing data in an old SQLite file is not copied
automatically; export and transform it before importing it into Supabase if it
must be retained.

## Render deployment

The repository includes [`render.yaml`](render.yaml), which defines a Node
backend, a static React frontend, and a persistent disk for uploaded media.

To deploy:

1. Push the repository to GitHub.
2. In Render, choose **New → Blueprint** and select this repository.
3. Enter the Supabase `DATABASE_URL` and `DIRECT_URL`.
4. Enter a strong `JWT_SECRET`, `SEED_ADMIN_USERNAME`, and
   `SEED_ADMIN_PASSWORD`.
5. After Render creates the services, copy the frontend Render URL.
6. Set backend `CORS_ORIGINS` and `PUBLIC_APP_URL` to that frontend URL.
7. Set frontend `VITE_API_URL` to
   `https://<backend-render-host>/api`.
8. Set frontend `VITE_SOCKET_URL` to
   `https://<backend-render-host>`.
9. Redeploy both services after saving these values.

The backend health check should respond at
`https://<backend-render-host>/api/health`.

Supabase must be reachable from Render and both database URLs must be valid.
The Blueprint runs migrations and the repeatable seed in its pre-deploy
command, before the new server instance starts. Persistent
media disks require a Render plan that supports them. For larger or
multi-instance deployments, move media to object storage and keep only asset
metadata in PostgreSQL.

## Running backend tests against PostgreSQL

The backend tests no longer create SQLite files. They require a disposable
PostgreSQL database and two URLs:

- `TEST_DATABASE_URL`: the pooled URL used for runtime Prisma queries.
- `TEST_DIRECT_URL`: the direct/session URL used to create an isolated schema
  and run Prisma migrations.

The explicit confirmation variable is a safety guard. It prevents the test
harness from running migrations against a normal development or production
database:

```bash
cd apps/game-server
TEST_DATABASE_URL='postgresql://.../postgres' \
TEST_DIRECT_URL='postgresql://.../postgres' \
TEST_DATABASE_CONFIRMATION='quiz-platform-test' \
JWT_SECRET='a-local-test-secret-with-at-least-32-characters' \
npm test
```

Use a separate Supabase project or database dedicated to tests. Each test file
creates a unique PostgreSQL schema and never drops, truncates, or resets it.
The pooled URL is used by Prisma clients; the direct URL is used only for
schema creation and `prisma migrate deploy`. Never point these variables at
the production Supabase project.

## Media storage note

Question media is currently stored on the backend filesystem. In the Render
Blueprint this is `/var/data/uploads` on a persistent Render disk; it is not
Supabase Storage. This is suitable only for a single backend instance and a
plan with persistent disks. A production multi-instance deployment should add
a storage adapter for Supabase Storage or another object-storage service,
store the object key instead of a local path, generate authorized media URLs,
and update replacement/deletion cleanup to remove the remote object.

## Checks for developers

Backend:

```bash
cd apps/game-server
npm run typecheck
npm run build
npm test
```

Frontend:

```bash
cd apps/web
npm run typecheck
npm run build
```

Prisma validation:

```bash
cd apps/game-server
npx prisma validate
```

## Important deployment note

The current live-game timers are held in the memory of one game-server
process. The application is suitable for local development and a
single-process deployment. Do not run multiple game-server instances behind a
load balancer until shared session state, timer coordination, and restart
recovery have been added.

For production, use a strong `JWT_SECRET`, a strong admin password, persistent
database and media storage, HTTPS, backups, and a deployment configuration
appropriate for your expected number of players.
