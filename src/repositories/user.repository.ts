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
