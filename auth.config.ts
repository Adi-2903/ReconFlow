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
      const isPublicHome = nextUrl.pathname === "/"

      if (isOnSignIn || isOnSignUp) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/dashboard", nextUrl))
        }
        return true
      }

      // Allow public access to the landing page
      if (isPublicHome) {
        return true
      }

      // Allow API routes to handle their own authentication to avoid HTML redirects on fetch
      if (nextUrl.pathname.startsWith('/api/')) {
        return true
      }

      return isLoggedIn
    },
<<<<<<< Updated upstream
    jwt({ token, user }) {
      if (user) token.userId = user.id
      return token
    },
    session({ session, token }) {
      if (session?.user) {
        session.user.id = token.userId as string
=======
    // NOTE: The jwt callback is intentionally NOT defined here.
    // It lives exclusively in auth.ts (non-Edge, full Node.js runtime)
    // where it can make DB calls.
    //
    // The session callback IS required here because the Edge middleware's
    // authorized() callback reads auth?.user?.onboarded. Without this,
    // the middleware never sees the onboarded field (it's undefined/false)
    // and every authenticated user gets redirected to /onboarding forever.
    session({ session, token }) {
      if (session?.user) {
        session.user.id = token.userId as string;
        session.user.onboarded = token.onboarded as boolean;
>>>>>>> Stashed changes
      }
      return session;
    },
  }
} satisfies NextAuthConfig
