import { SourceLayout } from "./layout.interface";

export const hdfcLayout: SourceLayout = {
  id: "hdfc",
  name: "HDFC Bank",
  fileType: "bank_csv",
  headers: ["Date", "Narration", "Chq./Ref.No.", "Value Date", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
  mapping: {
    date: "Date",
    description: "Narration",
    debit: "Withdrawal Amt.",
    credit: "Deposit Amt.",
    reference: "Chq./Ref.No.",
  },
};
