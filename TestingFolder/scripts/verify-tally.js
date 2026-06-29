"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
var fs = __importStar(require("fs"));
var xlsx = __importStar(require("xlsx"));
var tally_ledger_parser_1 = require("../../services/parsers/tally-ledger.parser");
var cleaning_service_1 = require("../../services/cleaning.service");
var fileBuffer = fs.readFileSync("C:/Nisarg Docs/ReconFlow/Tally.xlsx");
var workbook = xlsx.read(fileBuffer, { type: "buffer" });
var sheetName = workbook.SheetNames[0];
var worksheet = workbook.Sheets[sheetName];
var rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: false });
var cleaningService = new cleaning_service_1.CleaningService({
    defaultCurrency: "USD",
    inferredDateFormat: "DD/MM/YYYY",
    accountLocale: "en-IN",
    accountCurrency: "INR",
    orgCurrency: "INR",
});
var parsed = (0, tally_ledger_parser_1.parseTallyLedger)(rows, cleaningService, "tally_export");
console.log("=== Tally Ledger Parsing Verification ===");
console.log("Extracted Opening Balance: ".concat((_a = parsed.metadata.openingBalance) !== null && _a !== void 0 ? _a : "None"));
console.log("Extracted Closing Balance: ".concat((_b = parsed.metadata.closingBalance) !== null && _b !== void 0 ? _b : "None"));
console.log("Total Transactions Imported: ".concat(parsed.transactions.length));
console.log("\nFirst 5 Canonical Transactions:");
for (var i = 0; i < Math.min(5, parsed.transactions.length); i++) {
    var t = parsed.transactions[i];
    console.log("Txn ".concat(i + 1, ": ").concat(t.date, " | ").concat(t.direction, " | Amount: ").concat(t.amountMinor, " | Narration: ").concat(t.rawNarration, " | Vch: ").concat(t.voucherType, " ").concat(t.voucherNumber));
}
console.log("\nWarnings:", parsed.parserWarnings);
console.log("Errors:", parsed.validationErrors);
