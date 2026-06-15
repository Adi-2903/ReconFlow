// tests/matching.test.ts

import fs from "fs";
import csv from "csv-parser";

export async function loadExpected() {
    const rows: any[] = [];

    return new Promise((resolve) => {
        fs.createReadStream(
            "./expected_matches.csv"
        )
            .pipe(csv())
            .on("data", (row) =>
                rows.push(row)
            )
            .on("end", () =>
                resolve(rows)
            );
    });
}