import * as fs from "fs";
import * as xlsx from "xlsx";
import { parseTallyLedger } from "../../services/parsers/tally-ledger.parser";
import { CleaningService } from "../../services/cleaning.service";

const fileBuffer = fs.readFileSync("C:/Nisarg Docs/ReconFlow/Tally.xlsx");
const workbook = xlsx.read(fileBuffer, { type: "buffer" });
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const rows = xlsx.utils.sheet_to_json<string[]>(worksheet, { header: 1, raw: false });

const cleaningService = new CleaningService({
  defaultCurrency: "USD",
  inferredDateFormat: "DD/MM/YYYY",
  accountLocale: "en-IN",
  accountCurrency: "INR",
  orgCurrency: "INR",
});

const parsed = parseTallyLedger(rows, cleaningService, "tally_export");

console.log("=== Tally Ledger Parsing Verification ===");
console.log(`Extracted Opening Balance: ${parsed.metadata.openingBalance ?? "None"}`);
console.log(`Extracted Closing Balance: ${parsed.metadata.closingBalance ?? "None"}`);
console.log(`Total Transactions Imported: ${parsed.transactions.length}`);

console.log("\nFirst 5 Canonical Transactions:");
for (let i = 0; i < Math.min(5, parsed.transactions.length); i++) {
  const t = parsed.transactions[i];
  console.log(`Txn ${i + 1}: ${t.date} | ${t.direction} | Amount: ${t.amountMinor} | Narration: ${t.rawNarration} | Vch: ${t.voucherType} ${t.voucherNumber}`);
}

console.log("\nWarnings:", parsed.parserWarnings);
console.log("Errors:", parsed.validationErrors);
