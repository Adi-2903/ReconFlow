import { SourceLayout } from "./layout.interface";

export const iciciLayout: SourceLayout = {
  id: "icici",
  name: "ICICI Bank",
  fileType: "bank_csv",
  headers: ["Value Date", "Transaction Date", "Cheque Number", "Transaction Remarks", "Withdrawal (Dr)", "Deposit (Cr)", "Balance"],
  mapping: {
    date: "Transaction Date",
    description: "Transaction Remarks",
    debit: "Withdrawal (Dr)",
    credit: "Deposit (Cr)",
    reference: "Cheque Number",
  },
};
