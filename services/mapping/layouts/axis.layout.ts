import { SourceLayout } from "./layout.interface";

export const axisLayout: SourceLayout = {
  id: "axis",
  name: "Axis Bank",
  fileType: "bank_csv",
  headers: ["Tran Date", "CHQ NO", "PARTICULARS", "DEBIT", "CREDIT", "BAL"],
  mapping: {
    date: "Tran Date",
    description: "PARTICULARS",
    debit: "DEBIT",
    credit: "CREDIT",
    reference: "CHQ NO",
  },
};
