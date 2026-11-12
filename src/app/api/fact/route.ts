import { NextResponse } from "next/server";
import type { ErrorResponse, FactResponse } from "@/lib/api";
import { getSessionUserId } from "@/lib/session";
import { getFactForUser } from "@/services/facts";

// GET /api/fact takes no parameters. Whose fact it is comes only from the
// session cookie, so there is nothing a client can change to ask for someone else's.

function error(status: number, code: string, message: string) {
  return NextResponse.json<ErrorResponse>({ error: { code, message } }, { status });
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return error(401, "unauthorized", "Your session has ended. Sign in again.");

  const result = await getFactForUser(userId);
  switch (result.status) {
    case "ok":
      return NextResponse.json<FactResponse>(
        { fact: { ...result.fact, createdAt: result.fact.createdAt.toISOString() } },
        { headers: { "Cache-Control": "no-store" } },
      );
    case "no_movie":
      return error(409, "no_movie", "Pick a favorite movie first.");
    case "unavailable":
      return error(503, "fact_unavailable", "We couldn't come up with a fact right now. Try again in a minute.");
  }
}
