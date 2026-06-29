import "dotenv/config";
import { firstNonEmpty, MatchingSignalsMetadata } from "../../services/exceptions.service";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

function resolveReference(
  referenceId: string | null | undefined,
  metadata: MatchingSignalsMetadata | null | undefined
): string {
  const signals = metadata?.matchingSignals ?? {};
  return firstNonEmpty(
    referenceId,
    signals.utr,
    signals.referenceNumber,
    signals.invoiceNumber,
    signals.voucherNumber
  ) ?? "N/A";
}

async function runTests() {
  console.log("Starting Exceptions Reference Resolution Unit Tests...");

  try {
    // =========================================================================
    // Test A: Priority Winner
    // =========================================================================
    const refA = resolveReference("INV-100", {
      matchingSignals: {
        utr: "331071526305",
        referenceNumber: "INV-200"
      }
    });
    assert(refA === "INV-100", `Test A: direct referenceId takes precedence (got: ${refA}, expected: INV-100)`);

    // =========================================================================
    // Test B: Missing Metadata / Nulls Resilience
    // =========================================================================
    const refB1 = resolveReference(null, null);
    assert(refB1 === "N/A", `Test B1: null referenceId and null metadata returns N/A (got: ${refB1})`);

    const refB2 = resolveReference(undefined, undefined);
    assert(refB2 === "N/A", `Test B2: undefined returns N/A (got: ${refB2})`);

    const refB3 = resolveReference("   ", {});
    assert(refB3 === "N/A", `Test B3: whitespace referenceId and empty metadata returns N/A (got: ${refB3})`);

    // =========================================================================
    // Test C: referenceNumber Fallback
    // =========================================================================
    const refC = resolveReference(null, {
      matchingSignals: {
        referenceNumber: "REF-999"
      }
    });
    assert(refC === "REF-999", `Test C: fallback to matchingSignals.referenceNumber succeeds (got: ${refC})`);

    // =========================================================================
    // Test D: invoiceNumber Fallback
    // =========================================================================
    const refD = resolveReference(null, {
      matchingSignals: {
        invoiceNumber: "INV-555"
      }
    });
    assert(refD === "INV-555", `Test D: fallback to matchingSignals.invoiceNumber succeeds (got: ${refD})`);

    // =========================================================================
    // Test E: voucherNumber Fallback
    // =========================================================================
    const refE = resolveReference(null, {
      matchingSignals: {
        voucherNumber: "VCH-777"
      }
    });
    assert(refE === "VCH-777", `Test E: fallback to matchingSignals.voucherNumber succeeds (got: ${refE})`);

    // =========================================================================
    // Test F: Empty String Fallback
    // =========================================================================
    const refF = resolveReference("", {
      matchingSignals: {
        utr: "331071526305"
      }
    });
    assert(refF === "331071526305", `Test F: empty string referenceId correctly triggers fallback (got: ${refF})`);

    const refF2 = resolveReference("   ", {
      matchingSignals: {
        utr: "331071526305"
      }
    });
    assert(refF2 === "331071526305", `Test F2: whitespace-only referenceId correctly triggers fallback (got: ${refF2})`);

    // =========================================================================
    // Priority Fallback Order Check
    // =========================================================================
    const refOrder1 = resolveReference("", {
      matchingSignals: {
        utr: "UTR-111",
        referenceNumber: "REF-222"
      }
    });
    assert(refOrder1 === "UTR-111", `Priority check: utr wins over referenceNumber (got: ${refOrder1})`);

    const refOrder2 = resolveReference("", {
      matchingSignals: {
        referenceNumber: "REF-222",
        invoiceNumber: "INV-333"
      }
    });
    assert(refOrder2 === "REF-222", `Priority check: referenceNumber wins over invoiceNumber (got: ${refOrder2})`);

    // =========================================================================
    // JSON Serialization check
    // =========================================================================
    try {
      const payload = { reference: refOrder1 };
      JSON.stringify(payload);
      assert(true, "JSON.stringify executes successfully on resolved reference");
    } catch (e: any) {
      assert(false, `JSON.stringify fails: ${e.message}`);
    }

  } catch (err: any) {
    console.error("Test suite failed:", err);
    failed++;
  }

  console.log(`\nTests completed: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
