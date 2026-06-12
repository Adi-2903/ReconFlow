import type { NextAuthConfig } from "next-auth"

export const authConfig = {
  providers: [], // No providers here to avoid Edge database driver dependencies
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in"
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.userId = user.id
      return token
    },
    session({ session, token }) {
      session.user.id = token.userId as string
      return session
    }
  }
} satisfies NextAuthConfig
