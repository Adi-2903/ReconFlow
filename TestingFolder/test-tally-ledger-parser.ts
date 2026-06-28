import { parseTallyLedger } from "../services/parsers/tally-ledger.parser";
import { CleaningService } from "../services/cleaning.service";

async function runTests() {
  console.log("=== Running Tally Ledger Parser Isolated Tests ===");

  const cleaningService = new CleaningService({
    defaultCurrency: "INR",
    inferredDateFormat: "DD-MMM-YY",
    accountLocale: "en-IN",
    accountCurrency: "INR",
    orgCurrency: "INR",
  });

  let failed = false;

  // Helper assert
  function assert(condition: boolean, message: string) {
    if (!condition) {
      console.error(`❌ ASSERTION FAILED: ${message}`);
      failed = true;
    } else {
      console.log(`✅ ${message}`);
    }
  }

  // Test Case 1: Standard Tally Ledger Rows Parsing
  try {
    const tallyRows = [
      ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit"],
      ["20-Jan-26", "Office Rent", "Payment", "PV/01", "", "15000.00"]
    ];

    const result = parseTallyLedger(tallyRows, cleaningService, "tally_export");

    assert(result.transactions.length === 1, "Should parse exactly 1 transaction");
    if (result.transactions.length === 1) {
      const txn = result.transactions[0];
      assert(txn.date === "2026-01-20", "Should parse and normalize date correctly");
      assert(txn.rawNarration === "Office Rent", "Should extract particulars/narration");
      assert(txn.voucherType === "Payment", "Should extract voucher type");
      assert(txn.voucherNumber === "PV/01", "Should extract voucher number");
    }
  } catch (err: any) {
    console.error("Test Case 1 FAILED with unexpected error:", err);
    failed = true;
  }

  // Test Case 2: Date Inheritance
  try {
    const tallyRows = [
      ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit"],
      ["20-Jan-26", "First Txn", "Payment", "PV/01", "", "100.00"],
      ["", "Second Txn (Inherited Date)", "Payment", "PV/02", "", "200.00"]
    ];

    const result = parseTallyLedger(tallyRows, cleaningService, "tally_export");

    assert(result.transactions.length === 2, "Should parse 2 transactions");
    if (result.transactions.length === 2) {
      assert(result.transactions[0].date === "2026-01-20", "First transaction date should be normalized");
      assert(result.transactions[1].date === "2026-01-20", "Second transaction should inherit the first transaction's date");
      assert(result.diagnostics?.inheritedDateCount === 1, "Diagnostics should report 1 inherited date");
    }
  } catch (err: any) {
    console.error("Test Case 2 FAILED with unexpected error:", err);
    failed = true;
  }

  // Test Case 3: Opening & Closing Balance Metadata Extraction
  try {
    const tallyRows = [
      ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit"],
      ["20-Jan-26", "Opening Balance", "", "", "50000.00", ""],
      ["20-Jan-26", "Office Supplies", "Payment", "PV/01", "", "500.00"],
      ["20-Jan-26", "Closing Balance", "", "", "49500.00", ""]
    ];

    const result = parseTallyLedger(tallyRows, cleaningService, "tally_export");

    assert(result.transactions.length === 1, "Should skip balance rows and parse 1 transaction");
    assert(result.metadata.openingBalance === 50000, `Opening balance should be 50000, got: ${result.metadata.openingBalance}`);
    assert(result.metadata.closingBalance === 49500, `Closing balance should be 49500, got: ${result.metadata.closingBalance}`);
  } catch (err: any) {
    console.error("Test Case 3 FAILED with unexpected error:", err);
    failed = true;
  }

  // Test Case 4: Invalid/Subtotal Rows Exclusion
  try {
    const tallyRows = [
      ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit"],
      ["20-Jan-26", "Interest Earned", "Receipt", "RV/01", "100.00", ""],
      ["20-Jan-26", "Subtotal Row", "Payment", "PV/02", "", ""], // Subtotal row (has date/type, but no amount)
      ["", " ", "", "", "", ""] // Blank row
    ];

    const result = parseTallyLedger(tallyRows, cleaningService, "tally_export");

    assert(result.transactions.length === 1, "Should skip subtotal and blank rows, parsing only 1 transaction");
    assert(result.diagnostics?.subtotalRowsSkipped === 1, `Should report 1 subtotal row skipped, got ${result.diagnostics?.subtotalRowsSkipped}`);
  } catch (err: any) {
    console.error("Test Case 4 FAILED with unexpected error:", err);
    failed = true;
  }

  // Test Case 5: Debit/Credit Inversion (Specific to Tally Prime Ledgers)
  try {
    const tallyRows = [
      ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit"],
      ["20-Jan-26", "Client Payment Received", "Receipt", "RV/01", "5000.00", ""], // Debit in Tally = Inflow
      ["20-Jan-26", "Vendor Bill Paid", "Payment", "PV/01", "", "3500.00"] // Credit in Tally = Outflow
    ];

    const result = parseTallyLedger(tallyRows, cleaningService, "tally_export");

    assert(result.transactions.length === 2, "Should parse 2 transactions");
    if (result.transactions.length === 2) {
      const receipt = result.transactions[0];
      const payment = result.transactions[1];

      // Verify Receipt (Debit) Inflow
      assert(receipt.direction === "inflow", `Receipt (Debit) should be inflow, got: ${receipt.direction}`);
      assert(receipt.amountMinor === 500000n, `Receipt amount should be 500000n paise, got: ${receipt.amountMinor}`);

      // Verify Payment (Credit) Outflow
      assert(payment.direction === "outflow", `Payment (Credit) should be outflow, got: ${payment.direction}`);
      assert(payment.amountMinor === 350000n, `Payment amount should be 350000n paise, got: ${payment.amountMinor}`);
    }
  } catch (err: any) {
    console.error("Test Case 5 FAILED with unexpected error:", err);
    failed = true;
  }

  if (failed) {
    console.error("\n❌ Some tests FAILED!");
    process.exit(1);
  } else {
    console.log("\n✨ All isolated Tally Ledger parser tests passed successfully!");
  }
}

runTests();
