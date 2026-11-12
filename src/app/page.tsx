import { redirect } from "next/navigation";
import { Wordmark } from "@/components/wordmark";
import { signInWithGoogle } from "@/lib/auth-actions";
import { getSessionUserId } from "@/lib/session";
import { getUserProfile, homePathFor } from "@/services/user.service";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await getSessionUserId();
  if (userId) {
    const profile = await getUserProfile(userId);
    if (profile) redirect(homePathFor(profile));
  }

  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 sm:px-8 sm:py-10">
      <Wordmark />

      <div className="my-auto py-16">
        <h1 className="font-marquee text-[clamp(3.25rem,11vw,7.5rem)] text-balance">
          Your favorite movie, <span className="text-outline">remembered.</span>
        </h1>
        <p className="mt-6 max-w-md text-lg text-muted">
          Tell us the film you love. Each time you visit, we&apos;ll tell you something about it.
        </p>

        {error && (
          <p role="alert" className="mt-6 font-medium text-error">
            Sign-in didn&apos;t work. Please try again.
          </p>
        )}

        <form action={signInWithGoogle} className="mt-8">
          <button type="submit" className="btn-pop">
            Sign in with Google
          </button>
        </form>
      </div>

      <p className="text-sm text-muted">We use your Google name, email, and photo. Nothing else.</p>
    </main>
  );
}
