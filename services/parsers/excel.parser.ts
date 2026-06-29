import * as XLSX from "xlsx";

export function parseExcel(buffer: Buffer, sheetName?: string): { rows: string[][]; sheetNames: string[] } {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetNames = workbook.SheetNames;
    if (sheetNames.length === 0) {
      throw new Error("Excel workbook contains no sheets.");
    }
    
    // Default to the first sheet or selected sheet
    const targetSheetName = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
    const sheet = workbook.Sheets[targetSheetName];
    
    // Extract sheet data as an array of arrays of strings
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, {
      header: 1,
      defval: "",
      raw: true, // Get underlying cell values
    });
    
    // Ensure all cells are strings
    const stringRows = rows.map((row) =>
      Array.isArray(row) ? row.map((cell) => {
        if (cell instanceof Date) {
          return cell.toISOString().split("T")[0]; // returns YYYY-MM-DD
        }
        if (typeof cell === "number") {
          return String(cell); // convert raw number to string without Excel formatting
        }
        return String(cell || "").trim();
      }) : []
    );

    return { rows: stringRows, sheetNames };
  } catch (error: any) {
    throw new Error(`Excel Parsing failed: ${error.message}`);
  }
}
