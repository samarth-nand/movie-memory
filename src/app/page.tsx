import { redirect } from "next/navigation";
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
    <main>
      <h1>Movie Memory</h1>
      <p>Tell us your favorite movie. We&apos;ll tell you something about it.</p>
      {error && <p role="alert">Sign-in didn&apos;t work. Please try again.</p>}
      <form action={signInWithGoogle}>
        <button type="submit">Sign in with Google</button>
      </form>
    </main>
  );
}
