import { FactGenerationError, generateMovieFact } from "@/lib/ai-gateway";
import { insertFact } from "@/repositories/fact.repository";
import { findUserProfile } from "@/repositories/user.repository";

export type FactResult =
  | { status: "ok"; fact: { content: string; createdAt: Date; stale: boolean } }
  | { status: "no_movie" }
  | { status: "unavailable" };

/** Base version: generate and store a new fact on every request. */
export async function getFactForUser(userId: string): Promise<FactResult> {
  const profile = await findUserProfile(userId);
  if (!profile?.favoriteMovie) return { status: "no_movie" };

  try {
    const content = await generateMovieFact(profile.favoriteMovie);
    const fact = await insertFact(userId, profile.favoriteMovie, content);
    return { status: "ok", fact: { content: fact.content, createdAt: fact.createdAt, stale: false } };
  } catch (error) {
    if (error instanceof FactGenerationError) return { status: "unavailable" };
    throw error;
  }
}
