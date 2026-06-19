import { SourceLayout } from "./layout.interface";

export const sbiLayout: SourceLayout = {
  id: "sbi",
  name: "State Bank of India",
  fileType: "bank_csv",
  headers: ["Txn Date", "Value Date", "Description", "Ref No./Cheque No.", "Debit", "Credit"],
  mapping: {
    date: "Txn Date",
    description: "Description",
    debit: "Debit",
    credit: "Credit",
    reference: "Ref No./Cheque No.",
  },
};
