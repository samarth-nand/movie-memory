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
- `npm test` runs Vitest. It needs no database, network, or env variables. The database integration tests are skipped unless `TEST_DATABASE_URL` is set.
- `npm run test:integration` runs the repository tests against a real, **throwaway** Postgres. With Neon:
  ```bash
  neon branches create --name it-local --schema-only --expires-at <ISO time ~1h ahead>
  TEST_DATABASE_URL="$(neon connection-string it-local --pooled)" npm run test:integration
  neon branches delete it-local
  ```
  Use the pooled URL: the app uses it at runtime, so the test also proves the lock works through the pooler.
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
  favoriteMovie String?   @db.VarChar(100)    // null = not onboarded yet
  factFailedAt  DateTime? @db.Timestamptz(3)  // last failed generation, for the cooldown
}

model Fact {
  id         String   @id @default(cuid())
  userId     String   // → User, onDelete: Cascade
  movieTitle String   @db.VarChar(100) // snapshot of the title the fact is about
  content    String   @db.Text
  createdAt  DateTime @default(dbgenerated("clock_timestamp()")) @db.Timestamptz(3)
  @@index([userId, movieTitle, createdAt(sort: Desc)])
}
```

- **`favoriteMovie` is one nullable column on User**, not a profile table. `null` is the "needs onboarding" state.
- **`Fact.movieTitle` is a snapshot, not a foreign key.** A fact is about the title it was generated for. The cache key is (user, current title), so a changed movie misses the cache with no invalidation code.
- **The composite index matches the one hot query,** "latest fact for this user and movie": an index scan that stops at the first row, with no sort. `userId` leads, so every lookup is scoped to one user.
- **The 100-character limit is also in the database** (`VARCHAR(100)`), backing up the app's validation. Postgres counts characters; JavaScript counts UTF-16 units, which is never fewer, so anything the app accepts fits.
- **`factFailedAt` is one nullable column,** not a table: it only ever holds the time of the user's latest failure.
- **`createdAt` is set by the database with `clock_timestamp()` and stored as `timestamptz`.** See the cache window below for why.
- **The Account, Session, and Fact tables cascade on user delete.**

### Variant A: how fact generation works (`src/services/fact.service.ts`)
1. **Fast path.** Read the latest fact for (session user, current movie). If it's **less than 60 seconds old**, return it. No lock, no OpenAI call.
2. **Lock.** Otherwise, open a transaction and take `pg_advisory_xact_lock(hashtext(userId))`. A second tab or a quick refresh waits here.
3. **Re-check.** With the lock held, read again. If the request ahead of us just stored a fact, return it. This is what turns a burst into a single OpenAI call.
4. **Generate.** Call OpenAI, insert the fact, return it. Committing releases the lock.
5. **Fail soft.** On an OpenAI timeout or error, a lock-wait timeout, or a transaction timeout, return the most recent fact for this user and movie with `stale: true`. If there isn't one, return a 503 with a friendly message.
6. **Cool down.** A failed generation records `User.factFailedAt` (database clock, written inside the transaction so it commits). For the next 15 seconds, waiters and refreshes skip OpenAI and go straight to step 5. A burst during an OpenAI outage makes one call instead of one per waiting request.

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
- **Failures:** every failure (timeout, API error, refusal, malformed output) becomes one thrown error, with the original attached as its `cause`. The details are logged on the server; the client gets a generic message.

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

### Tests (`npm test`: 34 tests; `npm run test:integration`: 6 more against Postgres)
- **The 60-second cache:**
  - A hit under 60s.
  - Just under the boundary (59.999s) is cached; exactly 60s regenerates, because the rule is "less than 60".
  - Moving from 59 to 60 seconds.
  - Movie scoping, and the no-movie case.
- **Burst:** two concurrent requests make exactly one OpenAI call and both get the same fact.
- **Cooldown:** after a failure, requests within 15 seconds skip OpenAI and serve the fallback; at 15 seconds it tries again; a burst during an outage makes one call; one user's failure doesn't affect another.
- **Failure:** returns the most recent fact marked stale; returns `unavailable` when there's none; lock or transaction failures fall back the same way.
- **Authorization:**
  - Another user's fresh fact for the same movie is never returned.
  - Another user's fact is never used as a fallback.
  - `GET /api/fact` returns 401 when signed out, without touching facts.
  - The service is called only with the session user.
- **Validation:** trimming, empty input, the 100/101-character boundary, and real titles with unusual characters.

The service gets its dependencies (repository, generator, user lookup) passed in, so tests use an in-memory store with a controllable clock and a mocked generator. There's no network or database involved.

**The integration tests** (`tests/fact.repository.integration.test.ts`) run the real repository against Postgres through the pooled URL:
- Facts are scoped to the requesting user, even for the same movie.
- Ages come from the database clock: a fact backdated by 90 seconds reads as about 90 seconds old.
- `createdAt` is the time of the write, not of the transaction start. Checked by making the test fail: switching the default back to `now()` made it fail at 1.77s.
- The lock: two locked sections for one user run one after the other, while another user isn't blocked.
- The lock wait gives up after `lockWaitMs`.
- The failure marker is per user and expires after the cooldown.

## Which variant, and why

**Variant A.** Its hard parts are correctness problems: defining "60 seconds old" when servers' clocks disagree, keeping two tabs from paying for two OpenAI calls, and degrading gracefully when a third-party API fails. I wanted to be judged on reasoning I can show in code and tests, and data modeling and concurrency are where a small app can still demonstrate that. From Variant B I borrowed only the idea of one typed fetch helper, because the dashboard needed a clean client boundary anyway.

## Key tradeoffs

- **A database connection is held during the OpenAI call.** The advisory lock lives in a transaction, so a cache miss pins a pooled connection for up to about 18 seconds, and waiters pin one too. Many first-time users at once could exhaust the pool even though none of them contend for the same lock. That's acceptable at this scale, and cache hits never take the lock. At scale I'd replace it with a lease row (`INSERT … ON CONFLICT DO NOTHING` with an expiry) and call OpenAI outside any transaction.
- **Why an advisory lock rather than the other options the brief allows:**
  - An in-memory lock breaks with more than one server instance.
  - A unique constraint per 60-second window uses fixed buckets: requests at 12:00:59 and 12:01:00 both generate, and the losing request has already paid for the OpenAI call before its insert fails.
  - A "generation in progress" flag needs expiry handling for crashed requests.
  - The advisory lock releases itself on commit, rollback, or disconnect. Because it's transaction-scoped, it works through Neon's transaction-mode pooler.
- **A 15-second cooldown after failures.** It stops a burst during an outage from retrying OpenAI once per waiting request: live, three simultaneous requests went from finishing at 3.3s, 5.2s, and 7.8s to all finishing around 4s, with one OpenAI call. The cost: after a brief failure, the user waits up to 15 seconds before a new fact is attempted, seeing the stale fact or the error meanwhile.
- **Facts are per user, not shared per movie.** That's simple and matches the brief, but it's the largest cost lever at scale.
- **Database sessions rather than JWTs.** One extra query per request, in exchange for server-side revocation and no Edge constraints.
- **Pages check auth, not Proxy.** Explicit and close to the data. The cost is that the redirect happens during render rather than at the edge.
- **The fact loads on the client after the page renders,** so name, photo, and movie appear immediately and the slow call gets its own loading, stale, and error states. In development, React Strict Mode fires the request twice on mount. That's a real burst, and the lock handles it.

## What I'd improve with 2 more hours

- **Run the integration tests in CI,** creating and deleting the Neon branch automatically (they run locally today).
- **Lease-row locking**, to stop holding a connection during the OpenAI call (described above).
- **Per-user rate limiting** on `GET /api/fact`.
- **CSP and security headers.**
- **Heuristic filtering of AI output** beyond schema validation.
- **Movie catalog lookup** (for example TMDB), so titles are canonical and facts can be shared per movie.
- **Inline movie editing**, which the snapshot schema already supports.
- **A fuller typed client layer and UI polish** beyond the three screens.
- **Pin `sslmode=verify-full`** in the connection strings before `pg` changes how `sslmode=require` behaves.

## AI usage

**Every architecture decision, and the plan for how this would be built, was mine. I wrote it as a detailed brief before any code existed. AI was the tool I directed to implement that plan, test it, and harden it.**

- **Architecture and build plan: mine, written up front.** My brief specified:
  - **Stack and tooling:** TypeScript, Next.js App Router, Prisma on Postgres, Auth.js for Google sign-in, the OpenAI SDK, Vitest. Library APIs were to be checked against current docs, not memory.
  - **Architecture.**
    - Thin route handlers and server actions: session check, Zod validation, call a service.
    - Services own the business rules.
    - Repositories are the only Prisma importers.
    - A single AI gateway is the only OpenAI importer.
    - Server components call services directly; client components go through one typed fetch helper (`lib/api.ts`) that parses with Zod and normalizes errors.
    - `server-only` markers on server modules.
    - Environment variables validated with Zod at startup.
  - **Data model requirements:** a nullable favorite movie on the user, and a Fact table with an index built for "latest fact for this user and movie".
  - **Security model:**
    - The user ID comes only from the session.
    - Server-side title validation (trim, 1–100 characters, no character allowlist).
    - No secrets reach the client.
    - Graceful handling of a missing Google name or photo.
  - **Prompt-injection defenses:** a fixed system prompt, the title passed as delimited data, single-field structured output validated with Zod, no tools, and plain-text rendering.
  - **Variant A design:**
    - A cache window measured by the database clock rather than app servers.
    - A per-user Postgres advisory lock inside a transaction, with a re-check after acquiring it.
    - An explicit transaction timeout longer than the OpenAI timeout.
    - About 8 seconds for OpenAI with at most one retry.
    - A stale-fact fallback, otherwise a friendly error.
    - The connection-holding tradeoff documented.
  - **Auth approach:** avoid Edge middleware with database sessions, with the four redirect rules.
  - **Testing strategy:** the 60-second boundary, failure fallback, and authorization, with OpenAI mocked so the service is testable without a network.
  - **Visual direction:** the theater-marquee concept, Big Shoulders Display for the title, Instrument Sans for everything else, the five-color palette, the patterns to avoid, the state copy, responsiveness, and visible keyboard focus.
  - **Working rules:** build in phases with a review after each, small commits, never commit secrets, keep `.env.example` current, ask when the spec is ambiguous, and add unrequested ideas to a "2 more hours" list instead of building them.

- **Phased delivery with checkpoints.** I set the phases (plan, scaffold, auth, onboarding, facts, Variant A, UI, docs) and reviewed the work at each checkpoint before moving on. I made the tradeoff calls:
  - keeping the schema minimal
  - session checks in pages rather than Proxy
  - the scope of the UI iterations
  - which fixes to make after grading the build against the spec: database length limits, a failure cooldown, and Postgres integration tests
- **Implementation assistant.** I used Claude Code to write the code and tests to my specification, then reviewed and adjusted the result. Where it proposed lower-level details inside my design, I reviewed and approved them before they went in: the exact Prisma schema, using `clock_timestamp()`, the specific timeout values, and the failure cooldown. I had it check library APIs against the installed packages instead of relying on memory. That surfaced several breaking changes I then designed around:
  - Prisma 7 moved connection URLs out of the schema.
  - Next 16 removed `next lint` and renamed middleware to Proxy.
  - The Auth.js v5 environment variable names changed.
  - Google merged Big Shoulders Display into Big Shoulders.
- **Agent skills and tools I used:**
  - **[ponytail](https://github.com/DietrichGebert/ponytail)** (a Claude Code plugin): I ran a cleanup pass using its `ponytail` and `ponytail-audit` skills. Their rules are the smallest complete change, delete what nothing uses, keep existing layers, and never cut validation, security, or tests. That pass removed four unused dependencies, two unneeded files, two redundant scripts, a custom error class, and a duplicate database lookup.
  - **Neon's agent setup guide and the Neon CLI:** for linking the database, and for creating schema-only, auto-expiring branches for the integration tests.
  - **GitHub CLI:** for creating and publishing the repository.
  - **Headless Chrome (puppeteer-core):** for screenshot checks of every screen and state.
  - The brief suggested the Impeccable or Taste design skills. They weren't installed, so the UI was designed by hand and checked with screenshots.
- **Testing.** Beyond the unit tests, I used it to:
  - drive live checks of every auth redirect with a temporary database session
  - verify the cache window, stale fallback, lock serialization, and failure cooldown against the real database
  - run the repository integration tests on a throwaway Neon branch, including deliberately breaking the timestamp default to prove the test catches it
  - screenshot every screen in headless Chrome at desktop and mobile widths

  I tested the real Google sign-in myself.
- **Bug fixing.** Lint and tests caught real issues that were fixed before commit:
  - a synchronous state update inside a React effect
  - a lockfile missing platform binaries
  - punctuation colliding in the display type
- **Security testing.** Testing caught a session-token leak: the Auth.js session callback spread the database session row into `/api/auth/session`. It was fixed before commit and is described above. Before publishing, I had the full git history scanned for secrets.
