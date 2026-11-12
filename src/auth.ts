import "server-only";
import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

// The adapter is the one Prisma user outside src/repositories: Auth.js owns the
// User/Account/Session tables and needs the client directly.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Database sessions: revocable server-side. Checked in server components, not
  // Edge middleware, because Prisma doesn't run on the Edge runtime.
  session: { strategy: "database" },
  secret: env.AUTH_SECRET,
  providers: [Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET })],
  // The landing page is the sign-in page; errors go back there instead of Auth.js's built-in pages.
  pages: { signIn: "/", error: "/" },
  callbacks: {
    // With database sessions, `session` is the DB session row (including the
    // session token) and `user` is the full user row. Build the payload from
    // scratch: spreading either would expose the token to client JS through
    // /api/auth/session, defeating the httpOnly cookie.
    session({ session, user }) {
      return {
        expires: session.expires,
        user: { id: user.id, name: user.name, email: user.email, image: user.image },
      };
    },
  },
});
