import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { db } from "@/core/db"
import { users } from "@/core/db/schema"
import { eq } from "drizzle-orm"
import { authConfig } from "./auth.config"

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        if (user.email) {
          try {
            const dbUser = await db.select().from(users).where(eq(users.email, user.email)).limit(1);
            if (dbUser.length > 0) {
              token.userId = dbUser[0].id;
            } else {
              // Create user if not exists (e.g., Google first sign-in)
              const newUser = await db.insert(users).values({
                email: user.email,
                companyName: user.name || "My Company"
              }).returning();
              token.userId = newUser[0].id;
            }
          } catch (error) {
            console.error("Error in JWT database callback:", error);
            token.userId = user.id; // fallback
          }
        } else {
          token.userId = user.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
      }
      return session;
    }
  }
})
