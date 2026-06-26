import { db } from "./index";
import { organizations, organizationMembers, financialAccounts, users } from "./schema";
import { eq, and } from "drizzle-orm";

/**
 * Resolves the user's active organization ID, or creates a default one if it doesn't exist.
 */
export async function getOrCreateUserOrganization(userId: string): Promise<string> {
  // 1. Check if user is already a member of any organization
  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .limit(1);

  if (member) {
    return member.organizationId;
  }

  // 2. Fallback: User doesn't have an organization, let's create a default one
  // First, verify the user exists in the users table. If not, insert them.
  const [existingUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!existingUser) {
    // Auth.js session might have a user ID that isn't fully synced or registered in user table yet
    await db.insert(users).values({
      id: userId,
      email: `user-${userId}@example.com`,
      name: "Default User",
    }).onConflictDoNothing();
  }

  // Create the organization
  const [newOrg] = await db
    .insert(organizations)
    .values({
      name: "Default Organization",
      baseCurrency: "USD",
    })
    .returning();

  // Add the user as the owner of this organization
  await db.insert(organizationMembers).values({
    organizationId: newOrg.id,
    userId: userId,
    role: "owner",
  });

  return newOrg.id;
}

/**
 * Resolves the financial account ID for the given organization and type, or creates one if it doesn't exist.
 */
export async function getOrCreateFinancialAccount(
  orgId: string,
  type: "bank" | "quickbooks" | "tally" | "stripe",
  name: string
): Promise<string> {
  const [existingAccount] = await db
    .select()
    .from(financialAccounts)
    .where(
      and(
        eq(financialAccounts.organizationId, orgId),
        eq(financialAccounts.accountType, type)
      )
    )
    .limit(1);

  if (existingAccount) {
    return existingAccount.id;
  }

  // Fetch organization base currency to default the financial account currency
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const orgCurrency = org?.baseCurrency || "USD";

  const [newAccount] = await db
    .insert(financialAccounts)
    .values({
      organizationId: orgId,
      accountType: type,
      name: name,
      baseCurrency: orgCurrency,
    })
    .returning();

  return newAccount.id;
}
