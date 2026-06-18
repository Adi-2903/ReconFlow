import { parseTallyXml } from "../services/parsers/tally.parser";
import * as fs from "fs";
import * as path from "path";

async function runTests() {
  console.log("=== Running Tally XML Parser Isolated Tests ===");

  // Test Case 1: Standard Tally XML File Parsing
  try {
    const xmlPath = path.join(__dirname, "data", "tally_transactions.xml");
    const content = fs.readFileSync(xmlPath, "utf8");
    const rows = await parseTallyXml(content);

    console.log("Test Case 1 (Standard Parse): SUCCESS");
    console.log("Total Rows Parsed:", rows.length);
    console.log("Headers:", rows[0]);
    console.log("First Voucher Row Example:");
    console.log(rows[1]);
  } catch (err: any) {
    console.error("Test Case 1 FAILED:", err);
  }

  // Test Case 2: XXE Entity Attack Blocking
  try {
    const xxePayload = `<?xml version="1.0" encoding="ISO-8859-1"?>
    <!DOCTYPE foo [  
      <!ELEMENT foo ANY >
      <!ENTITY xxe SYSTEM "file:///etc/passwd" >]>
    <ENVELOPE>
      <BODY>
        <IMPORTDATA>
          <REQUESTDATA>
            <TALLYMESSAGE>
              <VOUCHER>
                <DATE>20260301</DATE>
              </VOUCHER>
            </TALLYMESSAGE>
          </REQUESTDATA>
        </IMPORTDATA>
      </BODY>
    </ENVELOPE>`;
    await parseTallyXml(xxePayload);
    console.error("Test Case 2 FAILED (Should have blocked XXE DTD!)");
  } catch (err: any) {
    if (err.message.includes("XXE Security Violation")) {
      console.log("Test Case 2 (XXE Entity Blocking): SUCCESS (Correctly blocked with message:", err.message, ")");
    } else {
      console.error("Test Case 2 FAILED (Unexpected error):", err);
    }
  }

  // Test Case 3: Empty XML File
  try {
    await parseTallyXml("");
    console.error("Test Case 3 FAILED (Should have thrown on empty content)");
  } catch (err: any) {
    console.log("Test Case 3 (Empty Content): SUCCESS (Correctly caught:", err.message, ")");
  }
}

runTests();
