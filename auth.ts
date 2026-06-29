import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { db } from "@/core/db"
import { users } from "@/core/db/schema"
import { eq } from "drizzle-orm"
import bcrypt from "bcryptjs"
import { authConfig } from "./auth.config"

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        
        const normalizedEmail = (credentials.email as string).trim().toLowerCase();
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, normalizedEmail))
          .limit(1);
        
        if (!user || !user.passwordHash) return null;
        
        const isValid = await bcrypt.compare(credentials.password as string, user.passwordHash);
        if (!isValid) return null;
        
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          onboarded: user.onboarded,
        };
      }
    })
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        if (!user.email) return false;
        const normalizedEmail = user.email.trim().toLowerCase();
        
        try {
          // Thread-safe Drizzle insert targeting email explicitly
          await db
            .insert(users)
            .values({
              email: normalizedEmail,
              name: user.name || "My Company",
              image: user.image || null,
            })
            .onConflictDoNothing({ target: users.email });
        } catch (error) {
          console.error("Error creating Google user on sign-in:", error);
        }
      }
      return true;
    },
    async jwt({ token, user, trigger }) {
      // 1. Initial login (user object is present)
      if (user && user.email) {
        const normalizedEmail = user.email.trim().toLowerCase();
        try {
          const [dbUser] = await db
            .select()
            .from(users)
            .where(eq(users.email, normalizedEmail))
            .limit(1);
          if (dbUser) {
            token.userId = dbUser.id;
            token.onboarded = dbUser.onboarded;
          }
        } catch (error: any) {
          console.error("Error looking up user in JWT callback:", error);
        }
      }

      // 2. Session update refresh (triggered on update() from client)
      if (trigger === "update" && token.userId) {
        try {
          const [dbUser] = await db
            .select()
            .from(users)
            .where(eq(users.id, token.userId as string))
            .limit(1);
          if (dbUser) {
            token.onboarded = dbUser.onboarded;
          }
        } catch (error: any) {
          console.error("Error refreshing onboarding status in JWT:", error);
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.onboarded = token.onboarded as boolean;
      }
      return session;
    }
  }
})
