"use server";

import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { movieTitleSchema } from "@/lib/validation";
import { completeOnboarding } from "@/services/user.service";

export type OnboardingState = { error: string | null; value: string };

/**
 * Server actions are public POST endpoints, so this re-checks everything:
 * the user ID comes from the session (never the form), and the title is
 * validated here regardless of what the browser enforced.
 */
export async function saveFavoriteMovie(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const raw = formData.get("movie");
  const parsed = movieTitleSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Enter a movie title.",
      value: typeof raw === "string" ? raw : "",
    };
  }

  await completeOnboarding(userId, parsed.data);
  redirect("/dashboard");
}
