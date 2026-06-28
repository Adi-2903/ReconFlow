import * as fs from "fs";
import * as xlsx from "xlsx";
import { parseCsv } from "../../services/parsers/csv.parser";

const bankBuffer = fs.readFileSync("C:/Nisarg Docs/ReconFlow/TestingFolder/data/fixture_c_bank_statement.csv", "utf8");
const bankRows = parseCsv(bankBuffer);

const tallyBuffer = fs.readFileSync("C:/Nisarg Docs/ReconFlow/TestingFolder/data/fixture_c_tally_daybook.xlsx");
const workbook = xlsx.read(tallyBuffer, { type: "buffer" });
const sheetName = workbook.SheetNames[0];
const tallyRows = xlsx.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], { header: 1, raw: false });

console.log("=== Bank Statement Sample Rows ===");
for (let i = 0; i < 10 && i < bankRows.length; i++) {
  console.log(`Bank Row ${i}:`, JSON.stringify(bankRows[i]));
}

console.log("\n=== Tally Ledger Sample Rows ===");
for (let i = 0; i < 15 && i < tallyRows.length; i++) {
  console.log(`Tally Row ${i}:`, JSON.stringify(tallyRows[i]));
}
