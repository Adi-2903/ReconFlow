export interface SourceLayout {
  id: string;
  name: string;
  fileType: "bank_csv" | "bank_excel" | "qbo_export" | "tally_export" | "stripe_export";
  headers: string[];
  mapping: {
    date: string;
    description: string;
    amount?: string;
    debit?: string;
    credit?: string;
    reference?: string;
    counterparty?: string;
  };
}
