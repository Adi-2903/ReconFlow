import { parseStatement } from "../../services/parsers/statement.parser";
import { parseTallyLedger } from "../../services/parsers/tally-ledger.parser";
import { CleaningService } from "../../services/cleaning.service";

const dummyCleaningService = new CleaningService({
  defaultCurrency: "INR",
  inferredDateFormat: "DD-MMM-YY",
  accountLocale: "en-IN",
  accountCurrency: "INR",
  orgCurrency: "INR",
});

// Real Bank Statement Row (Axis/ICICI style): Date, Narration, Amount(Credit for Inflow)
const bankRows = [
  ["Date", "Description", "Debit", "Credit", "Balance"],
  ["20-Jan-26", "IMPS-Courier Services Pvt Ltd", "2150.00", "", "15000.00"]
];

// Real Tally Ledger Row: Date, Particulars, Vch Type, Vch No, Debit, Credit (Payment = Credit)
const tallyRows = [
  ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit"],
  ["20-Jan-26", "Courier Services Pvt Ltd", "Payment", "PV/0205", "", "2150.00"]
];

const bankParsed = parseStatement(bankRows, "bank_csv", dummyCleaningService);
const tallyParsed = parseTallyLedger(tallyRows, dummyCleaningService, "tally_export");

console.log("=== Original Rows ===");
console.log("Bank Row:", JSON.stringify(bankRows[1]));
console.log("Tally Row:", JSON.stringify(tallyRows[1]));

console.log("\n=== Canonical Output ===");
console.log("Bank Canonical:", JSON.stringify(bankParsed.transactions[0], (key, value) => typeof value === 'bigint' ? value.toString() + 'n' : value, 2));
console.log("Tally Canonical:", JSON.stringify(tallyParsed.transactions[0], (key, value) => typeof value === 'bigint' ? value.toString() + 'n' : value, 2));
