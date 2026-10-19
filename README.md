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

You do not need Docker or a separate database for local development. The app
uses SQLite, which is a database file stored on your computer.

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

Open `apps/game-server/.env` and set a local admin login. For example:

```dotenv
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=admin
JWT_SECRET=use-a-long-random-secret-with-at-least-32-characters
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

The seed creates the configured local admin account and a small sample quiz.
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
| `DATABASE_URL` | SQLite database location | `file:./dev.db` |
| `JWT_SECRET` | Secret used to sign tokens | Must be replaced |
| `CORS_ORIGINS` | Allowed web-app origins | `http://localhost:3000` |
| `UPLOAD_DIR` | Uploaded media folder | `./uploads` |
| `PUBLIC_APP_URL` | URL encoded in join links and QR codes | `http://localhost:3000` |
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
