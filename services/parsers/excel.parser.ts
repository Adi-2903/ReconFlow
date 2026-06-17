import * as XLSX from "xlsx";

export function parseExcel(buffer: Buffer): { rows: string[][]; sheetNames: string[] } {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetNames = workbook.SheetNames;
    if (sheetNames.length === 0) {
      throw new Error("Excel workbook contains no sheets.");
    }
    
    // Default to the first sheet
    const firstSheetName = sheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    
    // Extract sheet data as an array of arrays of strings
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, {
      header: 1,
      defval: "",
      raw: false, // Convert values to formatted strings
    });
    
    // Ensure all cells are strings
    const stringRows = rows.map((row) =>
      Array.isArray(row) ? row.map((cell) => String(cell || "").trim()) : []
    );

    return { rows: stringRows, sheetNames };
  } catch (error: any) {
    throw new Error(`Excel Parsing failed: ${error.message}`);
  }
}
