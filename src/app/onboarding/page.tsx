import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { Wordmark } from "@/components/wordmark";
import { requireSessionUserId } from "@/lib/session";
import { getUserProfile, homePathFor } from "@/services/user.service";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const userId = await requireSessionUserId();
  const profile = await getUserProfile(userId);
  if (!profile) redirect("/");
  if (homePathFor(profile) !== "/onboarding") redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex items-center justify-between gap-4">
        <Wordmark />
        <SignOutButton />
      </header>

      <div className="my-auto py-16">
        <h1 className="text-2xl font-semibold sm:text-3xl">What&apos;s your favorite movie?</h1>
        <p className="mt-2 text-muted">Just the title. This is the one we&apos;ll keep.</p>
        <OnboardingForm />
      </div>
    </main>
  );
}
