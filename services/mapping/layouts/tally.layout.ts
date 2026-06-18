import { SourceLayout } from "./layout.interface";

export const tallyLayout: SourceLayout = {
  id: "tally",
  name: "Tally XML",
  fileType: "tally_export",
  headers: ["Date", "Voucher No", "Party Ledger Name", "Narration", "Voucher Type", "Ledger Entries"],
  mapping: {
    date: "Date",
    description: "Narration",
    reference: "Voucher No",
    counterparty: "Party Ledger Name",
    amount: "Ledger Entries",
  },
};
