import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";

const BCRYPT_ROUNDS = 12;

const signUpSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(12, "Password must be at least 12 characters long"),
  name: z.string().min(2, "Name must be at least 2 characters long").optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = signUpSchema.safeParse(body);
    
    if (!validated.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const email = validated.data.email.trim().toLowerCase();
    const { password, name } = validated.data;

    // Hash the password in one step
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    try {
      // Attempt atomic database insertion to prevent race conditions
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          name: name || "My Company",
          passwordHash,
        })
        .returning();

      return NextResponse.json({
        success: true,
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
        },
      });
    } catch (dbError: any) {
      // Handle unique constraint violation (Postgres error code 23505)
      if (dbError?.code === "23505") {
        // Query the existing user
        const [existingUser] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (existingUser) {
          // If the user has no passwordHash (Google signup), update it atomically
          if (!existingUser.passwordHash) {
            const [updatedUser] = await db
              .update(users)
              .set({
                passwordHash,
                name: existingUser.name || name || "My Company",
              })
              .where(and(eq(users.id, existingUser.id), isNull(users.passwordHash)))
              .returning();

            // If updatedUser is undefined, it means another concurrent request updated the password first
            if (updatedUser) {
              return NextResponse.json({
                success: true,
                linked: true,
                user: {
                  id: updatedUser.id,
                  email: updatedUser.email,
                  name: updatedUser.name,
                },
              });
            }
          }
        }
      }
      
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during registration" },
      { status: 500 }
    );
  }
}
