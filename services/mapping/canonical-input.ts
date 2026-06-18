import { z } from "zod";

export const CanonicalTransactionInputSchema = z.object({
  organizationId: z.string().uuid(),
  accountId: z.string().uuid(),
  rawRecordId: z.string().uuid().nullable().optional(),
  side: z.enum(["money", "books"]),
  direction: z.enum(["inflow", "outflow"]),
  status: z.enum([
    "RAW",
    "CLEANED",
    "MAPPED",
    "ENRICHED",
    "AVAILABLE",
    "LOCKED_CANDIDATE",
    "MATCHED_PENDING",
    "LOCKED_APPROVED",
  ]).default("AVAILABLE"),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "transactionDate must be in YYYY-MM-DD format",
  }),
  amountMinor: z.any().transform((val) => {
    if (typeof val === "bigint") return val;
    if (typeof val === "number") return BigInt(Math.round(val));
    try {
      return BigInt(val);
    } catch {
      return BigInt(0);
    }
  }),
  currency: z.string().length(3),
  referenceNumber: z.string().nullable().optional(),
  counterpartyName: z.string().nullable().optional(),
  counterpartyNormalized: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  transactionType: z.string().nullable().optional(),
  sourceTransactionId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type CanonicalTransactionInput = z.infer<typeof CanonicalTransactionInputSchema>;
