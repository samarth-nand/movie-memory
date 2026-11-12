import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorResponseSchema, factResponseSchema } from "@/lib/api";

// The route's two dependencies: who is signed in, and the fact service.
const getSessionUserId = vi.fn<() => Promise<string | null>>();
const getFactForUser = vi.fn();
vi.mock("@/lib/session", () => ({ getSessionUserId }));
vi.mock("@/services/facts", () => ({ getFactForUser }));

const { GET } = await import("@/app/api/fact/route");

beforeEach(() => {
  getSessionUserId.mockReset();
  getFactForUser.mockReset();
});

describe("GET /api/fact authorization", () => {
  it("returns 401 and never touches facts when signed out", async () => {
    getSessionUserId.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(errorResponseSchema.parse(await response.json()).error.code).toBe("unauthorized");
    expect(getFactForUser).not.toHaveBeenCalled();
  });

  it("asks for the session user's fact and no one else's", async () => {
    getSessionUserId.mockResolvedValue("alice");
    getFactForUser.mockResolvedValue({
      status: "ok",
      fact: { content: "A fact", createdAt: new Date("2026-01-01T00:00:00Z"), stale: false },
    });

    const response = await GET();

    expect(getFactForUser).toHaveBeenCalledExactlyOnceWith("alice");
    // The handler takes no request argument at all: no query string, header, or
    // body can carry a different user ID into it.
    expect(GET.length).toBe(0);
    expect(response.status).toBe(200);
    expect(factResponseSchema.parse(await response.json()).fact).toEqual({
      content: "A fact",
      createdAt: "2026-01-01T00:00:00.000Z",
      stale: false,
    });
  });
});

describe("GET /api/fact responses", () => {
  beforeEach(() => getSessionUserId.mockResolvedValue("alice"));

  it("passes the stale flag through", async () => {
    getFactForUser.mockResolvedValue({
      status: "ok",
      fact: { content: "Old fact", createdAt: new Date(), stale: true },
    });

    const body = factResponseSchema.parse(await (await GET()).json());
    expect(body.fact.stale).toBe(true);
  });

  it("returns 503 with a friendly message when no fact is available", async () => {
    getFactForUser.mockResolvedValue({ status: "unavailable" });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(errorResponseSchema.parse(await response.json()).error.message).toMatch(/try again/i);
  });

  it("returns 409 when the user has no movie yet", async () => {
    getFactForUser.mockResolvedValue({ status: "no_movie" });

    expect((await GET()).status).toBe(409);
  });
});
