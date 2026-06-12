import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { bankTransactions } from "@/core/db/schema";
import { parse } from "csv-parse/sync";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileContent = await file.text();

    // Basic CSV parsing
    // Expects headers like: Date, Description, Amount
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true
    });

    if (!records || records.length === 0) {
      return NextResponse.json({ error: "CSV file is empty or improperly formatted" }, { status: 400 });
    }

    const newTxns = records.map((record: any) => {
      // Find keys ignoring case
      const keys = Object.keys(record);
      const getVal = (possibleNames: string[]) => {
        const key = keys.find(k => possibleNames.includes(k.toLowerCase()));
        return key ? record[key] : null;
      };

      const date = getVal(["date", "txn date", "transaction date", "value date"]);
      const description = getVal(["description", "narration", "particulars", "memo"]);
      const amountStr = getVal(["amount", "withdrawal", "deposit", "credit", "debit", "total"]);

      // Cleanup amount
      let amountNum = 0;
      if (amountStr) {
        // Remove currency symbols and commas
        const cleanStr = amountStr.replace(/[^0-9.-]+/g, "");
        amountNum = parseFloat(cleanStr);
      }

      // We need amount in paise/cents
      const amountPaise = Math.round(amountNum * 100).toString();

      return {
        userId,
        amount: amountPaise,
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        description: description || "CSV Upload Transaction",
        source: "CSV Upload",
        status: "unmatched",
      };
    });

    // Bulk insert
    await db.insert(bankTransactions).values(newTxns);

    return NextResponse.json({ 
      count: newTxns.length, 
      message: "CSV imported successfully" 
    });

  } catch (error: any) {
    console.error("CSV Upload Error:", error);
    return NextResponse.json({ error: error.message || "Failed to process CSV" }, { status: 500 });
  }
}
