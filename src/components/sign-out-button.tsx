import { signOutUser } from "@/lib/auth-actions";

export function SignOutButton() {
  return (
    <form action={signOutUser}>
      <button type="submit">Sign out</button>
    </form>
  );
}
