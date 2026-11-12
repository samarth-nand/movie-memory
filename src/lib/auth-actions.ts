"use server";

import { signIn, signOut } from "@/auth";

// After Google, land on "/" which routes to onboarding or the dashboard.
// Keeping that rule in one place avoids duplicating it in redirect targets.
export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signOutUser() {
  await signOut({ redirectTo: "/" });
}
