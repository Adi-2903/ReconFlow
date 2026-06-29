import "dotenv/config";
import { db } from "../../core/db";
import { canonicalTransactions } from "../../core/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const defaultOrgId = "eff66e8c-6357-4484-9d7b-9d0b70f48f64";
  console.log(`\nFetching transactions for Organization: ${defaultOrgId}\n`);

  const txns = await db.select().from(canonicalTransactions).where(eq(canonicalTransactions.organizationId, defaultOrgId));

  console.log("--- BANK SIDE (money) TRANSACTIONS ---");
  const bankTxns = txns.filter(t => t.side === "money");
  for (const t of bankTxns) {
    console.log(`ID: ${t.id} | Date: ${t.transactionDate.toISOString().split("T")[0]} | Desc: "${t.description}" | Ref: ${t.referenceNumber} | Currency: ${t.currency} | BaseCurrency: ${t.baseCurrency} | AmtMinor: ${t.amountMinor} | ConvertedAmtMinor: ${t.convertedAmountMinor} | FxStatus: ${t.fxStatus}`);
  }

  console.log("\n--- LEDGER SIDE (books) TRANSACTIONS ---");
  const ledgerTxns = txns.filter(t => t.side === "books");
  for (const t of ledgerTxns) {
    console.log(`ID: ${t.id} | Date: ${t.transactionDate.toISOString().split("T")[0]} | Desc: "${t.description}" | Ref: ${t.referenceNumber} | Currency: ${t.currency} | BaseCurrency: ${t.baseCurrency} | AmtMinor: ${t.amountMinor} | ConvertedAmtMinor: ${t.convertedAmountMinor} | FxStatus: ${t.fxStatus}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
