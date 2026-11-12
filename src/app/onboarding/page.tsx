import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { requireSessionUserId } from "@/lib/session";
import { getUserProfile, homePathFor } from "@/services/user.service";

// Phase 3 shell: proves the redirects. The movie form arrives in Phase 4.
export default async function OnboardingPage() {
  const userId = await requireSessionUserId();
  const profile = await getUserProfile(userId);
  if (!profile) redirect("/");
  if (homePathFor(profile) !== "/onboarding") redirect("/dashboard");

  return (
    <main>
      <h1>What&apos;s your favorite movie?</h1>
      <SignOutButton />
    </main>
  );
}
