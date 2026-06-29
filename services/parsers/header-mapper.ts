import { HeaderMapping } from "./types";

export const HEADER_ALIASES = {
  date: [
    "transaction date",
    "tran date",
    "txn date",
    "date",
    "posting date",
    "post date",
    "time",
    "created",
    "dt"
  ],
  valueDate: [
    "value date"
  ],
  description: [
    "description",
    "narration",
    "particulars",
    "memo",
    "details",
    "transaction remarks",
    "remarks",
    "desc"
  ],
  amount: [
    "amount",
    "net amount",
    "total amount",
    "amount(inr)",
    "amount (inr)"
  ],
  debit: [
    "dr",
    "debit",
    "withdrawal",
    "withdrawal amount(inr)",
    "withdrawal amount (inr)",
    "outflow",
    "payment",
    "paid"
  ],
  credit: [
    "cr",
    "credit",
    "deposit",
    "deposit amount(inr)",
    "deposit amount (inr)",
    "inflow",
    "receipt",
    "received"
  ],
  balance: [
    "balance",
    "balance(inr)",
    "balance (inr)",
    "bal"
  ],
  reference: [
    "reference",
    "utr",
    "ref",
    "reference number",
    "ref num",
    "ref no",
    "cheque number",
    "cheque",
    "chq",
    "voucher",
    "vch",
    "cheque no",
    "chqno"
  ]
};

export function cleanHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Maps a given row of headers to canonical indices based on aliases.
 * Returns -1 for columns not found.
 */
export function mapHeaders(headers: string[]): HeaderMapping {
  const mapping: HeaderMapping = {
    date: -1,
    description: -1,
    amount: -1,
    debit: -1,
    credit: -1,
    balance: -1,
    reference: -1,
    valueDate: -1
  };

  const assignedHeaders = new Set<number>();
  
  // Create cleaned aliases arrays once
  const cleanAliases = {} as Record<keyof typeof HEADER_ALIASES, string[]>;
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    cleanAliases[key as keyof typeof HEADER_ALIASES] = aliases.map(a => cleanHeader(a));
  }

  const priorityOrder: (keyof typeof mapping)[] = [
    "date",
    "valueDate",
    "description",
    "debit",
    "credit",
    "amount",
    "balance",
    "reference"
  ];

  for (const key of priorityOrder) {
    const aliases = cleanAliases[key as keyof typeof HEADER_ALIASES];
    if (!aliases) continue;

    for (let i = 0; i < headers.length; i++) {
      if (assignedHeaders.has(i)) continue;

      const c = cleanHeader(headers[i]);
      if (!c) continue;

      // Exact match alias check
      if (aliases.includes(c)) {
        mapping[key] = i;
        assignedHeaders.add(i);
        break; // Stop looking for this key once found
      }
    }
  }

  // Fallback heuristic scoring for less rigid matching, similar to original column-detector
  // but simpler, since strict aliases should catch 99% of cases.
  for (const key of priorityOrder) {
    if (mapping[key] !== -1) continue;
    const aliases = cleanAliases[key as keyof typeof HEADER_ALIASES];
    if (!aliases) continue;

    for (let i = 0; i < headers.length; i++) {
      if (assignedHeaders.has(i)) continue;
      
      const c = cleanHeader(headers[i]);
      if (!c) continue;
      
      // Partial match if it's strongly related
      for (const a of aliases) {
        if (c.includes(a)) {
          mapping[key] = i;
          assignedHeaders.add(i);
          break;
        }
      }
      if (mapping[key] !== -1) break;
    }
  }

  return mapping;
}
