import type { NextAuthConfig } from "next-auth"

export const authConfig = {
  providers: [], // No providers here to avoid Edge database driver dependencies
  session: { 
    strategy: "jwt",
    maxAge: 2 * 60 * 60, // 2 hours expiry for financial security
  },
  pages: {
    signIn: "/sign-in"
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isOnSignIn = nextUrl.pathname === "/sign-in"
      const isOnSignUp = nextUrl.pathname === "/sign-up"

      if (isOnSignIn || isOnSignUp) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/dashboard", nextUrl))
        }
        return true
      }

      // Allow API routes to handle their own authentication to avoid HTML redirects on fetch
      if (nextUrl.pathname.startsWith('/api/')) {
        return true
      }

      return isLoggedIn
    },
    jwt({ token, user }) {
      if (user) token.userId = user.id
      return token
    },
    session({ session, token }) {
      if (session?.user) {
        session.user.id = token.userId as string
      }
      return session
    }
  }
} satisfies NextAuthConfig
