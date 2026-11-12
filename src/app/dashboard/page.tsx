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

  return (
    <main>
      <header>
        <Avatar image={profile.image} label={displayName} />
        <div>
          <p>{displayName}</p>
          {profile.email && profile.email !== displayName && <p>{profile.email}</p>}
        </div>
        <SignOutButton />
      </header>
      <p>Your favorite movie</p>
      <h1>{movie}</h1>
      <FactCard />
    </main>
  );
}
