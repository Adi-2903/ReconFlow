import { SourceLayout } from "./layout.interface";

export const iciciSavingsLayout: SourceLayout = {
  id: "icici_savings",
  name: "ICICI Bank Savings",
  fileType: "bank_excel",
  headers: ["Transaction Date", "Value Date", "Transaction Remarks", "Cheque Number", "Withdrawal Amount (INR)", "Deposit Amount (INR)", "Balance (INR)"],
  mapping: {
    date: "Transaction Date",
    description: "Transaction Remarks",
    debit: "Withdrawal Amount (INR)",
    credit: "Deposit Amount (INR)",
    reference: "Cheque Number",
  },
};
