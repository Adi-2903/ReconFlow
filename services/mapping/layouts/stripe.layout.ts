import { SourceLayout } from "./layout.interface";

export const stripeLayout: SourceLayout = {
  id: "stripe",
  name: "Stripe Statement Export",
  fileType: "stripe_export",
  headers: ["balance_transaction_id", "type", "source", "amount", "fee", "net", "currency", "created_utc", "available_on_utc", "description", "customer_email", "reporting_category"],
  mapping: {
    date: "created_utc",
    description: "description",
    amount: "net",
    reference: "balance_transaction_id",
    counterparty: "customer_email",
  },
};
