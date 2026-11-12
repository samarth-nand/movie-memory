import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * The signed-in user's ID. This is the only source of a user ID in the app:
 * no route, action, or service accepts one from the client.
 */
export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** For pages: signed-out visitors go to the landing page, which is the sign-in page. */
export async function requireSessionUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");
  return userId;
}
