import { z } from "zod";

export const MatchingSignalsSchema = z.object({
  channel: z.enum(["UPI", "NEFT", "RTGS", "IMPS", "CASH", "ACH", "CARD", "CHECK", "STRIPE", "WIRE"]).optional(),
  utr: z.string().optional(),
  invoiceNumber: z.string().optional(),
  voucherNumber: z.string().optional(),
  referenceNumber: z.string().optional(),
  customerName: z.string().optional(),
  vendorName: z.string().optional(),
  merchantName: z.string().optional(),
  relatedTransactionId: z.string().optional(),
});

export const BigIntSchema = z.union([
  z.string(),
  z.bigint(),
]).pipe(z.coerce.bigint());

export const CurrencyCodeSchema = z
  .string()
  .length(3)
  .transform((v) => v.toUpperCase())
  .refine(
    (v) => /^[A-Z]{3}$/.test(v),
    "Invalid ISO currency code"
  );

export const DecimalRateSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/);

export const CanonicalTransactionInputSchema = z.object({
  organizationId: z.string().uuid(),
  accountId: z.string().uuid(),
  rawRecordId: z.string().uuid().nullable().optional(),
  sourceSystem: z.enum(["bank", "quickbooks", "tally", "stripe", "xero", "netsuite"]),
  externalId: z.string().nullable().optional(),
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
  ]).default("RAW"),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "transactionDate must be in YYYY-MM-DD format",
  }),
  amountMinor: BigIntSchema,
  currency: CurrencyCodeSchema,
  referenceNumber: z.string().nullable().optional(),
  counterpartyName: z.string().nullable().optional(),
  counterpartyNormalized: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  transactionType: z.string().nullable().optional(),
  sourceTransactionId: z.string().nullable().optional(),
  baseCurrency: CurrencyCodeSchema.optional().nullable(),
  convertedAmountMinor: BigIntSchema.optional().nullable(),
  exchangeRate: DecimalRateSchema.optional().nullable(),
  exchangeRateSource: z.string().optional().nullable(),
  fxRateProvider: z.string().optional().nullable(),
  exchangeRateDate: z.string().optional().nullable(),
  fxStatus: z.enum(["NOT_REQUIRED", "SOURCE_PROVIDED", "CONVERTED", "MISSING_RATE"]).default("NOT_REQUIRED"),
  metadata: z.object({
    matchingSignals: MatchingSignalsSchema.optional(),
    intelligenceVersion: z.literal("v1").default("v1"),
  }).optional().default({ intelligenceVersion: "v1" }),
  embeddingStatus: z.enum(["PENDING", "GENERATED", "FAILED"]).default("PENDING"),
});

export type CanonicalTransactionInput = z.infer<typeof CanonicalTransactionInputSchema>;
