// The shared Vertex ledger's spend by source, against VERTEX_BUDGET_USD.
//   pnpm bench:spend            prints it
//   pnpm bench:spend --check    also exits 1 when the budget is unset or reached (cwb_run.sh starts with it)
import { readFileSync } from "node:fs";
import { assertUnderBudget, ledgerPath, type LedgerEntry } from "../scoring/vertex-ledger.ts";

const path = ledgerPath();
const bySource = new Map<string, { calls: number; cost: number }>();
let text = "";
try {
  text = readFileSync(path, "utf-8");
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
for (const line of text.split("\n").filter(Boolean)) {
  const { source, cost_usd } = JSON.parse(line) as LedgerEntry;
  const s = bySource.get(source) ?? { calls: 0, cost: 0 };
  bySource.set(source, { calls: s.calls + 1, cost: s.cost + cost_usd });
}
console.log(`ledger ${path}`);
for (const [source, { calls, cost }] of [...bySource].sort()) console.log(`  ${source.padEnd(18)} ${String(calls).padStart(7)} calls  $${cost.toFixed(4)}`);
console.log(`  ${"total".padEnd(18)} ${" ".repeat(13)}  $${[...bySource.values()].reduce((sum, s) => sum + s.cost, 0).toFixed(4)} of budget ${process.env.VERTEX_BUDGET_USD ? `$${process.env.VERTEX_BUDGET_USD}` : "(VERTEX_BUDGET_USD unset)"}`);
if (process.argv.includes("--check")) {
  try {
    assertUnderBudget();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
