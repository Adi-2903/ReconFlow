"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var statement_parser_1 = require("../../services/parsers/statement.parser");
var tally_ledger_parser_1 = require("../../services/parsers/tally-ledger.parser");
var cleaning_service_1 = require("../../services/cleaning.service");
var dummyCleaningService = new cleaning_service_1.CleaningService({
    defaultCurrency: "INR",
    inferredDateFormat: "DD-MMM-YY",
    accountLocale: "en-IN",
    accountCurrency: "INR",
    orgCurrency: "INR",
});
// Real Bank Statement Row (Axis/ICICI style): Date, Narration, Amount(Credit for Inflow)
var bankRows = [
    ["Date", "Description", "Debit", "Credit", "Balance"],
    ["20-Jan-26", "IMPS-Courier Services Pvt Ltd", "2150.00", "", "15000.00"]
];
// Real Tally Ledger Row: Date, Particulars, Vch Type, Vch No, Debit, Credit (Payment = Credit)
var tallyRows = [
    ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit"],
    ["20-Jan-26", "Courier Services Pvt Ltd", "Payment", "PV/0205", "", "2150.00"]
];
var bankParsed = (0, statement_parser_1.parseStatement)(bankRows, "bank_csv", dummyCleaningService);
var tallyParsed = (0, tally_ledger_parser_1.parseTallyLedger)(tallyRows, dummyCleaningService, "tally_export");
console.log("=== Original Rows ===");
console.log("Bank Row:", JSON.stringify(bankRows[1]));
console.log("Tally Row:", JSON.stringify(tallyRows[1]));
console.log("\n=== Canonical Output ===");
console.log("Bank Canonical:", JSON.stringify(bankParsed.transactions[0], function (key, value) { return typeof value === 'bigint' ? value.toString() + 'n' : value; }, 2));
console.log("Tally Canonical:", JSON.stringify(tallyParsed.transactions[0], function (key, value) { return typeof value === 'bigint' ? value.toString() + 'n' : value; }, 2));
