import { redirect } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { SignOutButton } from "@/components/sign-out-button";
import { requireSessionUserId } from "@/lib/session";
import { getUserProfile, homePathFor } from "@/services/user.service";
import { FactCard } from "./fact-card";

export default async function DashboardPage() {
  const userId = await requireSessionUserId();
  const profile = await getUserProfile(userId);
  if (!profile) redirect("/");
  const movie = profile.favoriteMovie;
  if (homePathFor(profile) !== "/dashboard" || !movie) redirect("/onboarding");

  // Google may not share a name or photo. Fall back to the email, then a neutral label.
  const displayName = profile.name?.trim() || profile.email || "Movie fan";
  const showEmail = profile.email && profile.email !== displayName;
  // Short titles fill the width; long ones (up to 100 characters) step down so they wrap cleanly.
  const titleSize =
    movie.length <= 20 ? "text-[clamp(4.5rem,22vw,12rem)]" : "text-[clamp(2.75rem,11vw,7rem)]";

  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex items-center gap-3 border-b border-ink/15 pb-5">
        <Avatar image={profile.image} label={displayName} />
        <div className="min-w-0">
          <p className="truncate font-medium">{displayName}</p>
          {showEmail && <p className="truncate text-sm text-muted">{profile.email}</p>}
        </div>
        <div className="ml-auto">
          <SignOutButton />
        </div>
      </header>

      <section aria-labelledby="movie-heading" className="py-12 sm:py-20">
        <p className="text-muted">Your favorite movie</p>
        <h1
          id="movie-heading"
          className={`font-marquee mt-3 ${titleSize} text-balance [overflow-wrap:anywhere]`}
        >
          {movie}
        </h1>
      </section>

      <FactCard />
    </main>
  );
}
