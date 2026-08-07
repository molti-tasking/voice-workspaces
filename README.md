# VoiceMural

A voice interface for thinking, with a repertoire that grows through use.

Capture happens on a phone while driving; the Workspace is a responsive web app
for seeing what was recorded and what was derived from it. See [Notes.md](Notes.md)
for the research framing.

---

## Quick start

```bash
cp .env.example .env          # then fill in GitHub OAuth + LiteLLM values
docker compose up -d          # Postgres only (pg-boss lives in the same DB)
pnpm install
pnpm db:migrate
pnpm dev                      # web on :3000, worker alongside it
```

Open <http://localhost:3000> and hit **Start recording**. No account, no OAuth
app, nothing to register — you get a guest identity and the starter repertoire
(`mark`, `diary`, `to-doc`, `interview`, …) immediately.

Then, to get something on screen without driving anywhere:

```bash
pnpm db:fixtures       # a demo session: 12 chunks, transcript, synthesised audio
```

This writes chunks already marked `transcribed`, so the Workspace, the
transcript view and provenance seeking all work without a LiteLLM key and
without a microphone.

### Accounts: guest by default

A guest is a real user row behind a cookie, so sessions, repertoire and
invocations are scoped exactly as for a signed-in user and the growth curve is
measured identically. Nothing about the research data is second-class.

**But guest identity is cookie-scoped.** Clear site data, switch browsers, or
record from a second device and you are a different person as far as the
database is concerned — your commutes split across two accounts and the growth
curve fragments. For the longitudinal deployment the paper depends on, sign in
properly on day one.

Signing in migrates everything the guest recorded onto the real account
(`packages/db/src/link-guest.ts`). This matters more than it looks: Better Auth
**deletes** the guest user on link, and every domain table cascades from `user`,
so the migration has to move the data first or signing in would destroy the
recordings. That path is integration-tested — see `link-guest.test.ts`.

**GitHub OAuth is optional.** Leave `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
empty and the sign-in button simply does not appear. To enable it, register an
app at <https://github.com/settings/developers> with callback
`http://localhost:3000/api/auth/callback/github`. Register a **second** app for
the deployed domain; one app cannot serve both.

**Wake lock is what makes this work.** iOS Safari suspends audio capture the
moment the screen locks or the browser backgrounds. Mount the phone, plug it in,
keep `/record` in the foreground. The recorder requests a screen wake lock and
warns you when it could not get one.

---

## Testing on a real phone

`getUserMedia` requires a secure context. `localhost` is exempt, but a phone on
your LAN is not — so use a tunnel:

```bash
pnpm tunnel                   # cloudflared → https://<random>.trycloudflare.com
```

Add that URL as the callback on a GitHub OAuth app and set `BETTER_AUTH_URL` to
match, otherwise sign-in will redirect to the wrong host.

---

## Architecture

```
apps/web      Next.js — Workspace UI, recorder PWA, API routes, Better Auth
apps/worker   pg-boss worker: transcription, sweeps, (later) rules and exports
packages/db   Drizzle schema + migrations   ← shared contract
packages/llm  LiteLLM wrappers (chat, transcribe)
packages/shared  Zod contracts, offset arithmetic, storage interface  ← shared contract
```

Packages ship TypeScript source rather than build artefacts. Next transpiles
them; the worker runs them through `tsx`. There is no per-package build step.

### Two decisions worth knowing before you change things

**The web app never enqueues jobs.** It only writes rows. The worker sweeps for
chunks in `stored` and queues them itself. A worker outage therefore cannot lose
work — chunks accumulate and drain on the next start — and the burst that
arrives when a phone regains signal after a tunnel is absorbed naturally.

**Every chunk is an independently decodable audio file.** The obvious approach,
`MediaRecorder.start(timeslice)`, only puts the container header in the *first*
blob; later blobs are bare fragments no decoder will read alone. Since chunks are
transcribed independently, that silently breaks the pipeline. The recorder
recycles the `MediaRecorder` per chunk against a persistent `MediaStream`
instead. The cost is a few milliseconds of audio at each boundary, which is why
`findCoverageGaps` tolerates sub-250ms discontinuities.

### The capture path

```
MediaRecorder → IndexedDB queue → POST /chunks → filesystem + audio_chunk row
                                                        ↓
                        worker sweep → pg-boss → LiteLLM Whisper → utterance rows
```

Chunks are written to IndexedDB **first** and deleted only once the server
acknowledges them. A commute goes through tunnels; without the local queue,
losing signal loses the recording.

---

## Data model

The schema is the paper's measurement apparatus, and the repertoire growth curve
cannot be reconstructed after the fact. Three consequences:

- `utterance` is **append-only and never mutated**. Corrections go to
  `kindOverride`. This is the asymmetry that makes misclassification survivable:
  artefacts are derived, so an error blemishes but never destroys.
- `capabilityVersion` is append-only, so *edits* are measurable, not just
  creations. `capabilityOrigin` records `createdVia` and the triggering session.
- `invocation` records every fire — including rejected and reverted ones. That
  is where frequency-ordering and "which capabilities survived" come from.

`artifact.spans` carries provenance back to source utterances. Treat it as a
constraint, not a feature to add later.

---

## Commands

| Command | Effect |
|---|---|
| `pnpm dev` | web + worker with hot reload |
| `pnpm typecheck` | all packages |
| `pnpm test` | unit tests (offset arithmetic especially) |
| `pnpm db:generate` | generate a migration from schema changes |
| `pnpm db:migrate` | apply migrations |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm db:seed` | re-install starter repertoire for all users |
| `pnpm db:fixtures` | seed a demo session with synthesised audio + transcript |

---

## Deployment (Coolify)

Add the repo as a **Docker Compose** resource, set the compose file to
`docker-compose.prod.yml`, and connect via the **GitHub App** — every push to
`main` then redeploys with no webhook config. Traefik terminates TLS and supplies
the public HTTPS domain, which the recorder needs anyway.

Set in Coolify's environment: `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB`, `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`LITELLM_BASE_URL`, `LITELLM_API_KEY`, and the three `MODEL_*` roles.

The `migrate` service runs to completion before `web` and `worker` start.

---

## Working in parallel

`packages/db` and `packages/shared` are the contracts — changing either is a
two-person decision. Otherwise the seams are independent:

| Seam | Scope |
|---|---|
| **A — Capture** | recorder PWA, IndexedDB queue, chunk upload, storage |
| **B — Pipeline** | worker jobs, transcription, classification, repertoire engine |
| **C — Workspace** | session/artefact/repertoire UI, growth-curve chart, exports |

A and B meet only at the `utterance` table. C consumes both and touches neither.
