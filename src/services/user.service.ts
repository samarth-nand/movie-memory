import {
  findUserProfile,
  setFavoriteMovieIfUnset,
  type UserProfile,
} from "@/repositories/user.repository";

export type { UserProfile };

export function getUserProfile(userId: string): Promise<UserProfile | null> {
  return findUserProfile(userId);
}

/** Where a signed-in user belongs: no favorite movie yet means onboarding. */
export function homePathFor(profile: Pick<UserProfile, "favoriteMovie">): "/onboarding" | "/dashboard" {
  return profile.favoriteMovie ? "/dashboard" : "/onboarding";
}

/**
 * Onboarding is first-time only. If the movie was already set (double submit,
 * second tab), the first answer stands and the caller still moves on to the
 * dashboard; there's nothing for the user to fix.
 */
export async function completeOnboarding(userId: string, movieTitle: string): Promise<void> {
  await setFavoriteMovieIfUnset(userId, movieTitle);
}
