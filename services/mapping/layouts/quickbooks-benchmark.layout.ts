import { SourceLayout } from "./layout.interface";

export const quickbooksBenchmarkLayout: SourceLayout = {
  id: "quickbooks_benchmark",
  name: "QuickBooks Benchmark Excel",
  fileType: "qbo_export",
  headers: ["transaction_id", "transaction_date", "transaction_type", "customer_vendor_name", "reference_number", "amount", "currency", "memo", "account_name"],
  mapping: {
    date: "transaction_date",
    description: "memo",
    amount: "amount",
    reference: "reference_number",
    counterparty: "customer_vendor_name",
  },
};
