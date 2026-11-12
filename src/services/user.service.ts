import { findUserProfile, type UserProfile } from "@/repositories/user.repository";

export type { UserProfile };

export function getUserProfile(userId: string): Promise<UserProfile | null> {
  return findUserProfile(userId);
}

/** Where a signed-in user belongs: no favorite movie yet means onboarding. */
export function homePathFor(profile: Pick<UserProfile, "favoriteMovie">): "/onboarding" | "/dashboard" {
  return profile.favoriteMovie ? "/dashboard" : "/onboarding";
}
