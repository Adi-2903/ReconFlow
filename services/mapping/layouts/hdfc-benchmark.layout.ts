import { SourceLayout } from "./layout.interface";

export const hdfcBenchmarkLayout: SourceLayout = {
  id: "hdfc_benchmark",
  name: "HDFC Benchmark CSV",
  fileType: "bank_csv",
  headers: ["Txn Date", "Value Date", "Narration", "Ref No / Cheque No", "Debit", "Credit", "Balance"],
  mapping: {
    date: "Txn Date",
    description: "Narration",
    debit: "Debit",
    credit: "Credit",
    reference: "Ref No / Cheque No",
  },
};
