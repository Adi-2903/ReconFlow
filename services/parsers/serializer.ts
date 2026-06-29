import { ParsedStatement } from "./types";

/**
 * Safely serializes a ParsedStatement for API boundaries.
 * Converts internal types (like BigInt) to JSON-safe alternatives,
 * and normalises internal representations (e.g. amountMinor -> amount)
 * for cleaner frontend consumption.
 */
export function serializeParsedStatement(statement: ParsedStatement | null) {
  if (!statement) return null;

  return {
    ...statement,
    transactions: statement.transactions.map((t) => {
      const { amountMinor, ...rest } = t;

      // Convert BigInt amountMinor (e.g., 5000n) to Number major units (e.g., 50)
      // We assume standard 2 decimal places for the preview display.
      const amount = Number(amountMinor) / 100;

      return {
        ...rest,
        amount,
      };
    }),
  };
}
