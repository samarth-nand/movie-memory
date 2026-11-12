import { signOutUser } from "@/lib/auth-actions";

export function SignOutButton() {
  return (
    <form action={signOutUser}>
      <button
        type="submit"
        className="text-sm font-medium text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink"
      >
        Sign out
      </button>
    </form>
  );
}
