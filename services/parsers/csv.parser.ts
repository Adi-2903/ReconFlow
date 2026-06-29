import { parse } from "csv-parse/sync";

export function parseCsv(content: string): string[][] {
  try {
    // Delimiter auto-detection (comma, semicolon, or tab)
    let delimiter = ",";
    const lines = content.split(/\r?\n/).slice(0, 5).filter(line => line.trim().length > 0);
    if (lines.length > 0) {
      const commas = (lines[0].match(/,/g) || []).length;
      const semicolons = (lines[0].match(/;/g) || []).length;
      const tabs = (lines[0].match(/\t/g) || []).length;
      
      if (semicolons > commas && semicolons > tabs) {
        delimiter = ";";
      } else if (tabs > commas && tabs > semicolons) {
        delimiter = "\t";
      }
    }

    const records = parse(content, {
      delimiter,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    });
    return records as string[][];
  } catch (error: any) {
    throw new Error(`CSV Parsing failed: ${error.message}`);
  }
}
