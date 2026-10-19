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
