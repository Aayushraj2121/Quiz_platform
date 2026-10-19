# GLITCH IN REALITY — E2E Test Report

**Execution date:** 2026-10-19
**Branch:** `feature/frontend`
**Starting HEAD:** `8d7052c36eeea6fef50daff2a017bd3cc03dee92`
**Working tree at start:** Clean except for the uncommitted
`docs/E2E_TEST_CASES.md` test plan.

## Environment

Testing used a disposable SQLite database at `/tmp/glitch-e2e.db`, a temporary
upload directory at `/tmp/glitch-e2e-uploads`, and isolated local ports:

- Backend: `http://127.0.0.1:4100`
- Frontend: `http://127.0.0.1:5177`
- Frontend API: `http://127.0.0.1:4100/api`
- Socket.IO: `http://127.0.0.1:4100`

The existing services on ports 4000/5173 were inspected and were using a
different disposable database, so they were not reused. No production data was
accessed. Secrets and tokens are omitted from this report.

## Commands and outcomes

| Command | Result |
|---|---|
| `DATABASE_URL=file:/tmp/glitch-e2e.db npm --prefix apps/game-server run db:deploy` | PASS — migration applied to fresh database |
| `DATABASE_URL=file:/tmp/glitch-e2e.db ... npm --prefix apps/game-server run db:seed` | PASS — seed completed |
| `npm --prefix apps/game-server run db:generate` | PASS — Prisma Client 6.19 generated |
| `curl http://127.0.0.1:4100/api/health` | PASS — HTTP 200 |
| `curl -I http://127.0.0.1:5177/` | PASS — HTTP 200 |
| `npm --prefix apps/web install --no-audit` | PASS |
| `npm --prefix apps/web run typecheck` | PASS |
| `npm --prefix apps/web run build` | PASS |
| `JWT_SECRET=<disposable> npm --prefix apps/game-server test` | PASS — 6 files, 19 tests (final rerun) |
| `npm --prefix apps/game-server run typecheck` | PASS |
| `npm --prefix apps/game-server run build` | PASS |
| `cd apps/game-server && DATABASE_URL=file:/tmp/glitch-e2e.db npx prisma validate` | PASS — Prisma 6.19 schema valid |
| `git diff --check` | PASS |
| `node /tmp/glitch-extended.mjs` | PASS — 23 extended API/Socket.IO/media/security assertions |

An initial backend test invocation without `JWT_SECRET` failed during
environment validation; it was rerun with the required disposable value and
passed. The first E2E runner treated the CSV response as JSON; a direct
follow-up verified HTTP 200, `text/csv`, the stable header, and result rows.
Neither was an application defect.

## Case results

`PASS` means the case was executed and the expected behavior was observed.
`BLOCKED` means the environment could not provide the required physical or
browser capability. `NOT RUN` means it was not executed and must not be
interpreted as passing.

| ID | Pri | Status | Evidence |
|---|---|---|---|
| E2E-001 | P0 | PASS | Isolated backend started on port 4100 with disposable configuration. |
| E2E-002 | P0 | PASS | Isolated Vite frontend started on port 5177 and loaded. |
| E2E-003 | P0 | PASS | `/api/health` returned HTTP 200. |
| E2E-004 | P1 | NOT RUN | Negative startup configuration test not executed. |
| E2E-005 | P1 | NOT RUN | No automated viewport matrix executed. |
| E2E-010 | P0 | PASS | Admin login returned 200 and no password hash. |
| E2E-011 | P0 | PASS | Admin identity endpoint returned 200 without secret fields. |
| E2E-012 | P0 | PASS | Wrong password returned 401. |
| E2E-013 | P0 | PASS | Missing token returned 401. |
| E2E-014 | P0 | PASS | Participant-style token was rejected by admin access. |
| E2E-015 | P1 | PASS | Login rate limiter returned a rate-limit response. |
| E2E-016 | P1 | NOT RUN | Frontend logout flow not implemented as a separate run. |
| E2E-020 | P0 | PASS | Quiz creation returned 201. |
| E2E-021 | P0 | PASS | Quiz publishing returned 200 and `PUBLISHED`. |
| E2E-022 | P0 | PASS | Invalid question options returned 400. |
| E2E-023 | P0 | PASS | Three questions persisted with orders 1, 2, and 3. |
| E2E-024 | P1 | NOT RUN | Update/delete authoring flow not separately run. |
| E2E-025 | P1 | NOT RUN | Cross-quiz admin isolation not separately run. |
| E2E-026 | P1 | PASS | Started question options contained no `isCorrect` field. |
| E2E-030 | P0 | PASS | Valid image upload returned 201 and was served successfully. |
| E2E-031 | P0 | PASS | Valid MP4 upload returned 201 and was served successfully. |
| E2E-032 | P0 | PASS | Invalid media signature returned 400. |
| E2E-033 | P0 | NOT RUN | Filename traversal matrix not included in this run. |
| E2E-034 | P1 | PASS | Replacement removed the old asset and deletion returned 204. |
| E2E-035 | P1 | PASS | Authorized media serving returned 200. |
| E2E-040 | P0 | PASS | Published quiz created a lobby with a six-digit PIN. |
| E2E-041 | P0 | BLOCKED | QR rendered and source format was inspected, but no physical QR scan was available. |
| E2E-042 | P0 | PASS | Browser opened `/?pin=440514`; PIN was prefilled. |
| E2E-043 | P0 | PASS | Browser changed the prefilled PIN to `123456`; input remained editable. |
| E2E-044 | P0 | PASS | Alice and Bob joined with HTTP 201 and safe participant payloads. |
| E2E-045 | P0 | PASS | Unknown PIN returned 404. |
| E2E-046 | P0 | PASS | Duplicate Alice name became `Alice (1)`. |
| E2E-047 | P1 | PASS | Concurrent joins received unique display names. |
| E2E-048 | P1 | PASS | Cross-session participant results were rejected. |
| E2E-050 | P0 | PASS | Host Socket.IO room join acknowledgement succeeded. |
| E2E-051 | P0 | PASS | Two participant room joins succeeded. |
| E2E-052 | P0 | PASS | Invalid Socket.IO token was rejected. |
| E2E-053 | P1 | NOT RUN | Browser refresh reconnect not separately run. |
| E2E-054 | P1 | NOT RUN | Lobby disconnect/count recovery not separately run. |
| E2E-060 | P0 | PASS | Host start delivered a safe question to participants. |
| E2E-061 | P0 | PASS | Correct answer acknowledgement succeeded. |
| E2E-062 | P0 | PASS | Incorrect answer acknowledgement succeeded. |
| E2E-063 | P0 | PASS | Duplicate answer returned `ALREADY_ANSWERED`. |
| E2E-064 | P0 | PASS | A well-formed fabricated option ID was rejected as `INVALID_OPTION`. |
| E2E-065 | P0 | NOT RUN | Late-answer/timer-expiry case not separately run. |
| E2E-066 | P0 | PASS | Reveal succeeded and exposed the correct option only at reveal. |
| E2E-067 | P1 | PASS | Host timer extension succeeded. |
| E2E-068 | P1 | PASS | Leaderboard transition succeeded with entries. |
| E2E-069 | P1 | NOT RUN | Host-disconnected automatic progression not separately run. |
| E2E-070 | P0 | PASS | Invalid `LOBBY -> LEADERBOARD` transition was rejected; repeated reveal finalization was idempotent. |
| E2E-080 | P0 | NOT RUN | Time-scaling formula was not independently measured in this run. |
| E2E-081 | P0 | NOT RUN | Three-question streak bonus/reset assertions not independently measured. |
| E2E-082 | P0 | NOT RUN | Deterministic tie fixture not independently created. |
| E2E-083 | P0 | PASS | Participant reconnect acknowledgement succeeded during gameplay. |
| E2E-084 | P0 | NOT RUN | Host reconnect in each lifecycle state not separately run. |
| E2E-085 | P1 | NOT RUN | Server restart limitation not exercised. |
| E2E-090 | P0 | PASS | End-game command succeeded; podium and game-ended events were observed. |
| E2E-091 | P0 | PASS | Persisted session reached `PODIUM`; podium event was observed. |
| E2E-092 | P0 | PASS | Admin results returned leaderboard data for the session. |
| E2E-093 | P0 | PASS | Participant results returned only the requesting participant. |
| E2E-094 | P0 | PASS | Direct CSV check returned 200, `text/csv`, stable header, and rows. |
| E2E-095 | P1 | PASS | CSV escaped commas, quotes, and special-character participant data. |
| E2E-096 | P0 | PASS | Certificate issued after end-game. |
| E2E-097 | P0 | PASS | Certificate verification returned 200. |
| E2E-098 | P1 | PASS | Repeated certificate issuance returned the same certificate. |
| E2E-100 | P0 | PASS | Gameplay question payload contained no correct-answer field; admin secrets were not returned. |
| E2E-101 | P0 | NOT RUN | Full REST/socket session-ID swap matrix not separately run. |
| E2E-102 | P1 | PASS | Oversized participant names were rejected at the backend/frontend-aligned 40-character limit. |
| E2E-103 | P1 | PASS | Sanitized startup/E2E output contained no tokens or passwords. |
| E2E-104 | P1 | PASS | Tracked-file inspection found no `.env`, DB, uploads, `node_modules`, or build artifacts. |

## Coverage summary

| Priority | PASS | FAIL | BLOCKED | NOT RUN |
|---|---:|---:|---:|---:|
| P0 | 40 | 0 | 1 | 7 |
| P1 | 13 | 0 | 0 | 9 |

The automated backend suite is green: 19 tests in 6 files. The real isolated
API/Socket.IO run used two independent participant sockets plus a host socket.
The browser run verified the join page, admin console, session QR rendering,
QR URL behavior, prefilled PIN, and editable PIN.

## Bugs and fixes

The following focused fixes were made during the extended verification:

1. Safe gameplay question payloads now include the associated media MIME type,
   and the frontend renders video assets with `<video>` rather than treating
   every asset as an image.
2. Backend participant-name validation now matches the frontend's 40-character
   limit.
3. The socket regression fixture now uses a well-formed fabricated option ID,
   distinguishing `INVALID_OPTION` from malformed-payload authorization
   rejection.
4. The socket score assertion allows the expected millisecond-level timing
   variation while preserving the configured score ceiling.

The CSV runner was also corrected to read CSV as text rather than JSON. The
backend test suite requires a disposable `JWT_SECRET`; the final rerun passed
all 19 tests with that configuration.

## Browser/device limitations

- A real phone or camera-based QR scan was not available; E2E-041 is therefore
  blocked rather than marked passed.
- A full three-browser visual run (host plus two participant browser contexts)
  was not available. The two-participant gameplay path was executed through
  independent Socket.IO clients, not claimed as a complete browser UI test.
- Filename traversal, responsive viewport coverage, timer-expiry races,
  host reconnect in every lifecycle state, and restart recovery remain
  unexecuted in this report.

## Merge verdict

**Not merge-ready under the documented gate.** The backend and frontend
branches are structurally compatible and the frontend branch already contains
the backend baseline, but the merge gate requires every P0 case to pass and at
least one real two-client browser gameplay run plus QR scan. E2E-041 remains
blocked, seven other P0 cases remain unexecuted, and the browser gameplay
requirement was not completed. Merge should wait for those cases or an
explicit approved deviation recorded in the PR.

## Final repository state

The test plan, this report, and the focused frontend/backend fixes are
uncommitted and unpushed. Generated local frontend dependencies, build output,
and `tsconfig.tsbuildinfo` were removed before handoff. No SQLite database,
upload directory, secret, or generated artifact is tracked.
