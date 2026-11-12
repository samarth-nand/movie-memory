import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { FactRepository } from "@/services/fact.service";

// Runs the real repository SQL against a real Postgres: the per-user lock, ages
// from the database clock, user scoping, and the failure marker. Skipped unless
// TEST_DATABASE_URL points at a throwaway database (e.g. a Neon branch; see README).
// Use the pooled URL: that's what the app uses, so it also proves the lock works
// through the transaction-mode pooler.
const url = process.env.TEST_DATABASE_URL;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { DATABASE_URL: process.env.TEST_DATABASE_URL } }));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!url)("fact repository against Postgres", () => {
  const run = Date.now().toString(36);
  const alice = `it-alice-${run}`;
  const bob = `it-bob-${run}`;
  let prisma: PrismaClient;
  let repo: FactRepository;
  let createRepo: typeof import("@/repositories/fact.repository").createPrismaFactRepository;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ createPrismaFactRepository: createRepo } = await import("@/repositories/fact.repository"));
    repo = createRepo({ lockWaitMs: 5_000, transactionTimeoutMs: 10_000 });
    await prisma.user.createMany({
      data: [
        { id: alice, favoriteMovie: "Heat" },
        { id: bob, favoriteMovie: "Heat" },
      ],
    });
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { id: { in: [alice, bob] } } }); // facts cascade
    await prisma?.$disconnect();
  });

  it("only returns the requesting user's facts, even for the same movie", async () => {
    await repo.insert(bob, "Heat", "Bob's fact");

    expect(await repo.findLatest(alice, "Heat")).toBeNull();
    expect(await repo.findLatest(bob, "Heat")).toMatchObject({ content: "Bob's fact" });
  });

  it("computes a fact's age with the database clock", async () => {
    await repo.insert(alice, "Heat", "Fresh");
    expect((await repo.findLatest(alice, "Heat"))!.ageSeconds).toBeLessThan(2);

    await prisma.$executeRaw`
      UPDATE "Fact" SET "createdAt" = clock_timestamp() - interval '90 seconds' WHERE "userId" = ${alice}`;
    const aged = await repo.findLatest(alice, "Heat");
    expect(aged!.ageSeconds).toBeGreaterThan(89);
    expect(aged!.ageSeconds).toBeLessThan(92);
  });

  it("stamps createdAt when the row is written, not when the transaction began", async () => {
    // With now() as the default, this fact would be ~1.5s old the moment it's written.
    await repo.withUserLock(alice, async (store) => {
      await sleep(1_500);
      await store.insert(alice, "Heat", "Written late in the transaction");
    });

    const latest = await repo.findLatest(alice, "Heat");
    expect(latest!.content).toBe("Written late in the transaction");
    expect(latest!.ageSeconds).toBeLessThan(1);
  });

  it("runs one locked section at a time per user, and different users in parallel", async () => {
    const spans: Record<string, [number, number]> = {};
    const work = (name: string) => async () => {
      const start = performance.now();
      await sleep(500);
      spans[name] = [start, performance.now()];
    };

    await Promise.all([
      repo.withUserLock(alice, work("alice-1")),
      repo.withUserLock(alice, work("alice-2")),
      repo.withUserLock(bob, work("bob")),
    ]);

    const [first, second] = [spans["alice-1"], spans["alice-2"]].sort((a, b) => a[0] - b[0]);
    expect(second[0]).toBeGreaterThanOrEqual(first[1]); // same user: serialized
    expect(spans["bob"][0]).toBeLessThan(Math.max(first[1], second[1])); // other user: not blocked
  });

  it("gives up waiting for the lock after lockWaitMs", async () => {
    const impatient = createRepo({ lockWaitMs: 300, transactionTimeoutMs: 5_000 });
    const holder = repo.withUserLock(alice, () => sleep(1_500));
    await sleep(200); // let the holder take the lock

    await expect(impatient.withUserLock(alice, async () => "never runs")).rejects.toThrow();
    await holder;
  });

  it("records failures per user and expires them after the cooldown", async () => {
    expect(await repo.failedWithin(alice, 15)).toBe(false);

    await repo.recordFailure(alice);
    expect(await repo.failedWithin(alice, 15)).toBe(true);
    expect(await repo.failedWithin(bob, 15)).toBe(false);

    await prisma.$executeRaw`
      UPDATE "User" SET "factFailedAt" = clock_timestamp() - interval '20 seconds' WHERE "id" = ${alice}`;
    expect(await repo.failedWithin(alice, 15)).toBe(false);
  });
});
