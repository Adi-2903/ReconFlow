import { SourceLayout } from "./layout.interface";

export const quickbooksLayout: SourceLayout = {
  id: "quickbooks",
  name: "QuickBooks",
  fileType: "qbo_export",
  headers: ["Txn Date", "Transaction Type", "Doc Number", "Name", "Memo/Description", "Account", "Amount"],
  mapping: {
    date: "Txn Date",
    description: "Memo/Description",
    amount: "Amount",
    reference: "Doc Number",
    counterparty: "Name",
  },
};
