import { SourceLayout } from "./layout.interface";

export const tallyBenchmarkLayout: SourceLayout = {
  id: "tally_benchmark",
  name: "Tally Benchmark Daybook",
  fileType: "tally_export",
  headers: ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit"],
  mapping: {
    date: "Date",
    description: "Particulars",
    debit: "Debit",
    credit: "Credit",
    reference: "Vch No.",
    counterparty: "Particulars",
  },
};
