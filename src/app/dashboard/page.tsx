import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { requireSessionUserId } from "@/lib/session";
import { getUserProfile, homePathFor } from "@/services/user.service";

// Phase 3 shell: proves the redirects. Profile details and the fact arrive in Phase 5.
export default async function DashboardPage() {
  const userId = await requireSessionUserId();
  const profile = await getUserProfile(userId);
  if (!profile) redirect("/");
  if (homePathFor(profile) !== "/dashboard") redirect("/onboarding");

  return (
    <main>
      <h1>{profile.favoriteMovie}</h1>
      <SignOutButton />
    </main>
  );
}
