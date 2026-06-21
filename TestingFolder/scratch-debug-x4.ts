import "dotenv/config";
import { db } from "../core/db";
import { canonicalTransactions, organizations } from "../schema";
import { runMatcher } from "./matching/runMatcher";
import { desc, eq } from "drizzle-orm";

// Mock mapping function
function mapRow(row: any): any {
  return {
    id: row.id,
    source: row.sourceSystem === "quickbooks" ? "quickbooks" : "bank",
    transactionDate: new Date(row.transactionDate),
    amount: Number(row.amountMinor) / 100,
    amountMinor: BigInt(row.amountMinor),
    direction: row.direction === "inflow" ? "credit" : "debit",
    counterparty: row.counterpartyName || undefined,
    referenceNumber: row.referenceNumber || undefined,
    description: row.description || undefined,
    sourceId: row.sourceTransactionId || row.id,
    currency: row.currency || undefined,
    baseCurrency: row.baseCurrency || undefined,
    convertedAmountMinor: row.convertedAmountMinor ? BigInt(row.convertedAmountMinor) : undefined,
    fxStatus: row.fxStatus as any,
    metadata: row.metadata || {},
    matchingSignals: row.metadata?.matchingSignals || {}
  };
}

async function debug() {
  const [latestOrg] = await db.select().from(organizations).orderBy(desc(organizations.createdAt)).limit(1);
  if (!latestOrg) {
    console.error("No organization found");
    return;
  }
  console.log("Debugging for Org:", latestOrg.name, "ID:", latestOrg.id);

  const allTxns = await db.select().from(canonicalTransactions).where(eq(canonicalTransactions.organizationId, latestOrg.id));
  const bankTxns = allTxns.filter((t: any) => t.side === "money").map(mapRow);
  const bookTxns = allTxns.filter((t: any) => t.side === "books").map(mapRow);

  const x4Banks = bankTxns.filter((t: any) => t.description && t.description.includes("X4"));
  const x4Books = bookTxns.filter((t: any) => t.referenceNumber && t.referenceNumber.includes("INV-207"));

  console.log("X4 Bank Transactions:", x4Banks);
  console.log("X4 Book Transactions:", x4Books);

  const matches = runMatcher(bankTxns, bookTxns);
  console.log("Matches generated involving X4:", matches.filter((m: any) => 
    m.bankTransactionIds.some((bid: any) => x4Banks.some((b: any) => b.id === bid)) ||
    m.bookTransactionIds.some((bid: any) => x4Books.some((b: any) => b.id === bid))
  ));
}

debug().catch(console.error);
