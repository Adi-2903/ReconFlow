import { hdfcLayout } from "./hdfc.layout";
import { iciciLayout } from "./icici.layout";
import { axisLayout } from "./axis.layout";
import { quickbooksLayout } from "./quickbooks.layout";
import { tallyLayout } from "./tally.layout";
import { hdfcBenchmarkLayout } from "./hdfc-benchmark.layout";
import { quickbooksBenchmarkLayout } from "./quickbooks-benchmark.layout";
import { tallyBenchmarkLayout } from "./tally-benchmark.layout";
import { sbiLayout } from "./sbi.layout";
import { stripeLayout } from "./stripe.layout";
import { iciciSavingsLayout } from "./icici-savings.layout";

import { SourceLayout } from "./layout.interface";

export const layouts: SourceLayout[] = [
  hdfcLayout,
  iciciLayout,
  axisLayout,
  quickbooksLayout,
  tallyLayout,
  hdfcBenchmarkLayout,
  quickbooksBenchmarkLayout,
  tallyBenchmarkLayout,
  sbiLayout,
  stripeLayout,
  iciciSavingsLayout,
];


