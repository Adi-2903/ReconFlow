import * as fs from "fs";
import * as xlsx from "xlsx";

const fileBuffer = fs.readFileSync("C:/Nisarg Docs/ReconFlow/Tally.xlsx");
const workbook = xlsx.read(fileBuffer, { type: "buffer" });
for (const sheetName of workbook.SheetNames) {
  console.log("Sheet Name:", sheetName);
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: false });
  for (let i = 0; i < jsonData.length; i++) {
    const rowStr = JSON.stringify(jsonData[i]);
    if (rowStr.toLowerCase().includes("opening") || rowStr.toLowerCase().includes("closing") || true) {
      console.log(`Row ${i}:`, rowStr);
    }
  }
}
