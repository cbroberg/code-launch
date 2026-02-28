import type { NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import { getServerSession } from "next-auth/next";

export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
      authorization: {
        params: { scope: "read:user read:org repo" },
      },
    }),
  ],

  callbacks: {
    async signIn({ profile }) {
      const allowed = process.env.AUTH_ALLOWED_USERS;
      if (!allowed) return true; // no allowlist → anyone with GitHub can sign in
      const users = allowed.split(",").map((u) => u.trim().toLowerCase());
      const login = ((profile as { login?: string })?.login ?? "").toLowerCase();
      return users.includes(login);
    },

    async jwt({ token, account, profile }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
        token.githubLogin = (profile as { login?: string })?.login ?? "";
      }
      return token;
    },

    async session({ session, token }) {
      (session as typeof session & { accessToken?: string; githubLogin?: string }).accessToken =
        token.accessToken as string | undefined;
      (session as typeof session & { accessToken?: string; githubLogin?: string }).githubLogin =
        token.githubLogin as string | undefined;
      return session;
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  session: { strategy: "jwt" },

  secret: process.env.NEXTAUTH_SECRET,
};

/** Convenience wrapper for server components and route handlers. */
export const auth = () => getServerSession(authOptions);
