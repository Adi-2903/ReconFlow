import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
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
      clientSecret: process.env.GOOGLE_CLIENT_SECRET, // Note: You'll need to add this to .env if you actually want Google login to work
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email) return null
        
        try {
          const existing = await db.select()
            .from(users)
            .where(eq(users.email, credentials.email as string))
            .limit(1)

          if (existing.length > 0) return { 
            id: existing[0].id, 
            email: existing[0].email,
            name: existing[0].companyName || existing[0].email
          }

          // Create new user for demo
          const newUser = await db.insert(users).values({
            email: credentials.email as string,
            companyName: "Demo Company"
          }).returning()

          return { 
            id: newUser[0].id, 
            email: newUser[0].email,
            name: newUser[0].companyName 
          }
        } catch (error: any) {
          console.error("==========================================");
          console.error("DATABASE CONNECTION FAILED IN AUTH.TS");
          console.error("This is likely a timeout reaching the remote database (e.g., Aurora).");
          console.error("Check your IP whitelisting, Security Groups, or DATABASE_URL password.");
          console.error("ERROR DETAILS:", error);
          console.error("==========================================");
          // Return null so NextAuth doesn't crash completely, or throw to show custom error
          throw new Error("Database connection failed. Check terminal logs.");
        }
      }
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
