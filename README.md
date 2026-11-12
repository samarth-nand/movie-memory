# Movie Memory

Sign in with Google, name your favorite movie, and get a fun fact about it from OpenAI. Built as the Base Implementation plus **Variant A: backend caching and correctness**.

Stack: TypeScript, Next.js 16 (App Router), React 19, Tailwind 4, Postgres (Neon), Prisma 7, Auth.js v5 (Google), the OpenAI API, and Vitest.

## Setup

Requires Node 20.9 or later.

```bash
npm install                  # also runs `prisma generate`
cp .env.example .env.local   # then fill it in (see below)
npx prisma migrate deploy    # apply migrations to your database
npm run dev                  # http://localhost:3000
```

Other commands:
- `npm test` runs Vitest. It needs no database, network, or env variables.
- `npm run lint` runs ESLint.
- `npm run build` creates a production build.

### Google OAuth client
In Google Cloud Console, go to **APIs & Services → Credentials → Create credentials → OAuth client ID** and choose **Web application**.
- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
- While the consent screen is in testing mode, add your Google account as a test user.

### Environment variables

All of these are validated with Zod when the app starts (`src/lib/env.schema.ts`). If any are missing, `next dev`, `next build`, and `next start` fail immediately and list the missing variable *names*, never their values.

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres, **pooled** (Neon's `-pooler` host). Used by the app at runtime. |
| `DATABASE_URL_UNPOOLED` | Postgres, **direct**. Used only by Prisma Migrate. |
| `AUTH_SECRET` | Encrypts Auth.js cookies and tokens. Generate with `npx auth secret`. At least 32 characters. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | The Google OAuth client from above. |
| `OPENAI_API_KEY` | Fact generation. Without credits, the app still runs and shows the friendly error or stale-fact states. |
| `AUTH_URL` | Optional in `next dev`. Required for `next start` and production: the public URL. |

With a single, non-Neon Postgres, set both database URLs to the same connection string.

### Database migrations
- `npx prisma migrate deploy` applies the committed migrations in `prisma/migrations/`. Use it for setup, CI, and production.
- `npm run db:migrate` (`prisma migrate dev`) creates a new migration after you change `prisma/schema.prisma`. Development only.

Prisma 7 reads connection URLs from `prisma.config.ts`, not the schema. That file loads `.env.local` with Next's own env loader, so the CLI and the app see the same values.

## Architecture

```
Browser
  │  pages (server components)        client components
  │        │                                 │ lib/api.ts (typed fetch + Zod)
  ▼        ▼                                 ▼
Route handlers / server actions ── session check, Zod validation, no business logic
  │   GET /api/fact · saveFavoriteMovie (server action) · /api/auth/* (Auth.js)
  ▼
Services ── business rules
  │   fact.service.ts (cache window, lock usage, fallback) · user.service.ts
  ▼
Repositories (the only Prisma importers)      AI gateway (the only OpenAI importer)
  │   user.repository.ts · fact.repository.ts       lib/ai-gateway.ts
  ▼                                                 ▼
Postgres                                          OpenAI
```

- **Pages** are server components. They read the session, call services directly, and redirect.
- **The only client code** is the onboarding form and the fact card. The fact card fetches `GET /api/fact` through `lib/api.ts`, which parses responses with the same Zod schemas the route uses and turns every failure into one `ApiError` shape.
- **`server-only`** is imported by repositories, the AI gateway, the env module, and the session helpers. Importing any of them into a client component fails the build, so secrets and database code can't reach the browser.

### Auth flow
Auth.js v5 with the Prisma adapter and **database sessions**, which can be revoked server-side. There is no middleware.
- Every protected page calls `requireSessionUserId()` and reads the profile through the user service.
- One function, `homePathFor(profile)`, sends users without a movie to `/onboarding` and everyone else to `/dashboard`.
- After Google sign-in, users return to `/`, which applies that rule. `/dashboard` and `/onboarding` apply it too, so every combination of signed-in state and movie state lands on the right page:

| Path | Signed out | Signed in, no movie | Signed in, has movie |
|---|---|---|---|
| `/` | Landing page with "Sign in with Google" | → `/onboarding` | → `/dashboard` |
| `/onboarding` | → `/` | Form | → `/dashboard` |
| `/dashboard` | → `/` | → `/onboarding` | Dashboard |

**Why there's no middleware.** The brief warns that database sessions don't work in Edge middleware with the Prisma adapter.
- Next 16 renamed middleware to Proxy, and it now runs on Node.
- Next's docs still recommend that Proxy do only cheap, optimistic cookie checks, because it runs on every request, including prefetches. The real check belongs next to the data.
- So the session check lives in the pages and the route handler, in the same place the data is read.

### Data model

```prisma
model User {                 // Auth.js fields, plus:
  favoriteMovie String?      // null = not onboarded yet
}

model Fact {
  id         String   @id @default(cuid())
  userId     String   // → User, onDelete: Cascade
  movieTitle String   // snapshot of the title the fact is about
  content    String   @db.Text
  createdAt  DateTime @default(dbgenerated("clock_timestamp()")) @db.Timestamptz(3)
  @@index([userId, movieTitle, createdAt(sort: Desc)])
}
```

- **`favoriteMovie` is one nullable column on User**, not a profile table. `null` is the "needs onboarding" state.
- **`Fact.movieTitle` is a snapshot, not a foreign key.** A fact is about the title it was generated for. The cache key is (user, current title), so a changed movie misses the cache with no invalidation code.
- **The composite index matches the one hot query,** "latest fact for this user and movie": an index scan that stops at the first row, with no sort. `userId` leads, so every lookup is scoped to one user.
- **`createdAt` is set by the database with `clock_timestamp()` and stored as `timestamptz`.** See the cache window below for why.
- **The Account, Session, and Fact tables cascade on user delete.**

### Variant A: how fact generation works (`src/services/fact.service.ts`)
1. **Fast path.** Read the latest fact for (session user, current movie). If it's **less than 60 seconds old**, return it. No lock, no OpenAI call.
2. **Lock.** Otherwise, open a transaction and take `pg_advisory_xact_lock(hashtext(userId))`. A second tab or a quick refresh waits here.
3. **Re-check.** With the lock held, read again. If the request ahead of us just stored a fact, return it. This is what turns a burst into a single OpenAI call.
4. **Generate.** Call OpenAI, insert the fact, return it. Committing releases the lock.
5. **Fail soft.** On an OpenAI timeout or error, a lock-wait timeout, or a transaction timeout, return the most recent fact for this user and movie with `stale: true`. If there isn't one, return a 503 with a friendly message.

**The cache window uses the database clock.** Postgres computes each fact's age as `clock_timestamp() - createdAt`, and `createdAt` is set by the column default. App servers never compare their own clocks against stored times, so clock skew between instances can't move the 60-second boundary. It's `clock_timestamp()` rather than `now()` because `now()` is frozen at the start of the transaction: a fact stored after a 6-second OpenAI call would be stamped 6 seconds early.

**Timeouts are derived from each other** (`src/services/facts.ts`):

| Setting | Value | How it's derived |
|---|---|---|
| OpenAI timeout | 8s per attempt, at most 1 retry | Requested in the brief |
| OpenAI hard cap | 18s | Caps the whole call. The SDK honors `retry-after` headers, which could otherwise stretch one call well past 16s. |
| Lock wait (`lock_timeout`) | 20s | The cap plus slack: a waiter can sit behind one full generation |
| Transaction timeout | 45s | Lock wait + one generation of its own + slack. Prisma's 5s default would cut off a normal OpenAI call. |

### Safe OpenAI integration
- **Prompt injection:** the movie title is untrusted.
  - The instructions are fixed and never contain user text.
  - The title is sent as a JSON value: `{"movie_title": "..."}`.
  - Output is structured (`zodTextFormat`) with a single `fact` field, and checked again with our own Zod schema (trimmed, 1–600 characters) before storage.
  - The model gets no tools.
  - The fact renders as a React text node, never as HTML or markdown.
- **Failures:** every failure (timeout, API error, refusal, malformed output) becomes a single `FactGenerationError`. The details are logged on the server; the client gets a generic message.

### Security
- **The user ID comes only from the session.** `GET /api/fact` takes no parameters at all. The onboarding server action reads the session, not the form. Every fact query filters by `userId`.
- **Movie input is validated on the server:** trimmed, then 1–100 characters. There's no character allowlist, because titles like "Amélie", "8½", and "千と千尋の神隠し" are real.
- **Onboarding is first-time only at the database level:** `UPDATE … WHERE favoriteMovie IS NULL`.
- **No secrets reach the client:** `server-only` modules, and no `NEXT_PUBLIC_` variables.
- **The session payload is built explicitly.** With database sessions, Auth.js hands the session callback the session row, including its token. Spreading it, a common snippet, would expose the token through `/api/auth/session`. We return only the expiry and the user's id, name, email, and image.
- **Missing Google data is handled:**
  - Missing name: falls back to the email, then "Movie fan".
  - Missing photo: falls back to an initial.
  - Photos are rendered only from Google's image host.

### Tests (`npm test`, 30 tests)
- **The 60-second cache:**
  - A hit under 60s.
  - Just under the boundary (59.999s) is cached; exactly 60s regenerates, because the rule is "less than 60".
  - Moving from 59 to 60 seconds.
  - Movie scoping, and the no-movie case.
- **Burst:** two concurrent requests make exactly one OpenAI call and both get the same fact.
- **Failure:** returns the most recent fact marked stale; returns `unavailable` when there's none; lock or transaction failures fall back the same way.
- **Authorization:**
  - Another user's fresh fact for the same movie is never returned.
  - Another user's fact is never used as a fallback.
  - `GET /api/fact` returns 401 when signed out, without touching facts.
  - The service is called only with the session user.
- **Validation:** trimming, empty input, the 100/101-character boundary, and real titles with unusual characters.

The service gets its dependencies (repository, generator, user lookup) passed in, so tests use an in-memory store with a controllable clock and a mocked generator. There's no network or database involved. The real advisory lock and SQL were verified by hand against Neon: three concurrent requests completed about 2.3s apart, serialized.

## Which variant, and why

**Variant A.** Its hard parts are correctness problems: defining "60 seconds old" when servers' clocks disagree, keeping two tabs from paying for two OpenAI calls, and degrading gracefully when a third-party API fails. I wanted to be judged on reasoning I can show in code and tests, and data modeling and concurrency are where a small app can still demonstrate that. From Variant B I borrowed only the idea of one typed fetch helper, because the dashboard needed a clean client boundary anyway.

## Key tradeoffs

- **A database connection is held during the OpenAI call.** The advisory lock lives in a transaction, so a cache miss pins a pooled connection for up to about 18 seconds, and waiters pin one too. Many first-time users at once could exhaust the pool even though none of them contend for the same lock. That's acceptable at this scale, and cache hits never take the lock. At scale I'd replace it with a lease row (`INSERT … ON CONFLICT DO NOTHING` with an expiry) and call OpenAI outside any transaction.
- **Why an advisory lock rather than the other options the brief allows:**
  - An in-memory lock breaks with more than one server instance.
  - A unique constraint per 60-second window uses fixed buckets: requests at 12:00:59 and 12:01:00 both generate, and the losing request has already paid for the OpenAI call before its insert fails.
  - A "generation in progress" flag needs expiry handling for crashed requests.
  - The advisory lock releases itself on commit, rollback, or disconnect. Because it's transaction-scoped, it works through Neon's transaction-mode pooler.
- **During an OpenAI outage, waiters retry one at a time.** If the request holding the lock fails, the next waiter tries OpenAI itself. Calls never overlap, but a burst during an outage makes several sequential attempts, each bounded by the timeouts.
- **Facts are per user, not shared per movie.** That's simple and matches the brief, but it's the largest cost lever at scale.
- **Database sessions rather than JWTs.** One extra query per request, in exchange for server-side revocation and no Edge constraints.
- **Pages check auth, not Proxy.** Explicit and close to the data. The cost is that the redirect happens during render rather than at the edge.
- **The fact loads on the client after the page renders,** so name, photo, and movie appear immediately and the slow call gets its own loading, stale, and error states. In development, React Strict Mode fires the request twice on mount. That's a real burst, and the lock handles it.

## What I'd improve with 2 more hours

- **Integration tests for the repository SQL** (advisory lock, `clock_timestamp()` ages) against a throwaway Neon branch, so the real lock is covered in CI, not only by hand.
- **A short "generation failed" marker per user,** so a burst during an OpenAI outage gives up quickly instead of each waiter retrying in turn.
- **Lease-row locking**, to stop holding a connection during the OpenAI call (described above).
- **Per-user rate limiting** on `GET /api/fact`.
- **CSP and security headers.**
- **Heuristic filtering of AI output** beyond schema validation.
- **Movie catalog lookup** (for example TMDB), so titles are canonical and facts can be shared per movie.
- **Inline movie editing**, which the snapshot schema already supports.
- **A fuller typed client layer and UI polish** beyond the three screens.
- **Pin `sslmode=verify-full`** in the connection strings before `pg` changes how `sslmode=require` behaves.

## AI usage

- I built this with Claude Code (Anthropic's coding agent) working in my repository, in phases I defined: plan, scaffold, auth, onboarding, facts, Variant A, UI, docs. I reviewed the plan, schema, scaffold, and auth phases one at a time, then had it finish the remaining phases in one run and reviewed those together.
- I wrote the brief and the constraints the agent worked under: the layering, the security rules, the Variant A approach (advisory lock, database clock, timeouts), and the visual direction.
- The agent wrote most of the code and tests. It checked library APIs against the installed packages rather than from memory, which caught several version changes:
  - Prisma 7 moved connection URLs out of the schema.
  - Next 16 removed `next lint` and renamed middleware to Proxy.
  - The Auth.js v5 environment variable names changed.
  - Google merged Big Shoulders Display into Big Shoulders.
- Verification went beyond the unit tests:
  - Each auth redirect was checked live with a temporary database session.
  - The cache window, stale fallback, and lock serialization were checked against the real database.
  - All screens were checked in headless Chrome at desktop and mobile widths.
- Testing caught one real security bug in the AI-written code: the Auth.js session callback spread the session row and exposed the session token through `/api/auth/session`. It was fixed before commit and is described above.
- I can explain every decision here; `NOTES.md` is the phase-by-phase log of what was decided and why.
