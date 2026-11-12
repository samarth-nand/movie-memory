import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { requireSessionUserId } from "@/lib/session";
import { getUserProfile, homePathFor } from "@/services/user.service";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const userId = await requireSessionUserId();
  const profile = await getUserProfile(userId);
  if (!profile) redirect("/");
  if (homePathFor(profile) !== "/onboarding") redirect("/dashboard");

  return (
    <main>
      <h1>What&apos;s your favorite movie?</h1>
      <OnboardingForm />
      <SignOutButton />
    </main>
  );
}
