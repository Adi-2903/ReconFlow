import { parse } from "csv-parse/sync";

export function parseCsv(content: string): string[][] {
  try {
    const records = parse(content, {
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
