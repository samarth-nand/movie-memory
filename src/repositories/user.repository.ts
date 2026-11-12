import "server-only";
import { prisma } from "@/lib/db";

const profileSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  favoriteMovie: true,
} as const;

export type UserProfile = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  favoriteMovie: string | null;
};

export function findUserProfile(userId: string): Promise<UserProfile | null> {
  return prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
}

/**
 * Sets the favorite movie only if it isn't set yet. The `favoriteMovie: null`
 * condition makes onboarding first-time-only at the database level: a double
 * submit or a second tab can't overwrite the first answer.
 */
export async function setFavoriteMovieIfUnset(userId: string, title: string): Promise<void> {
  await prisma.user.updateMany({
    where: { id: userId, favoriteMovie: null },
    data: { favoriteMovie: title },
  });
}
