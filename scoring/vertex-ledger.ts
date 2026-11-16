// Every Vertex call a judge makes is metered into one ledger, shared with the CodeWikiBench judges'
// LiteLLM proxy (/work/artifacts/codewikibench-2026-11-15/proxy/usage_log.py appends the same lines),
// and judging stops once the ledger reaches VERTEX_BUDGET_USD: a multi-day grid never spends more
// than the owner approved. Lines are appended with O_APPEND, one write each, so concurrent judge
// processes never interleave them; each check reads what the others have appended since.

import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { dirname } from "node:path";
import { wrapLanguageModel } from "ai";

export type LedgerSource = "arms-accuracy" | "arms-comparative" | "cwb";
export interface LedgerEntry {
  ts: string;
  source: LedgerSource;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export const DEFAULT_LEDGER = "/work/artifacts/model-grid-2026-11-16/vertex-ledger.jsonl";
export const ledgerPath = (): string => process.env.VERTEX_LEDGER || DEFAULT_LEDGER;

/** Stops the whole report: never caught as one judge call's failure. */
export class BudgetExceededError extends Error {
  override name = "BudgetExceededError";
}

/** No budget means no approved spend: an unset VERTEX_BUDGET_USD refuses like a spent one. */
export function budgetUsd(): number {
  const raw = process.env.VERTEX_BUDGET_USD;
  const budget = Number(raw);
  if (!raw || !(budget > 0)) throw new BudgetExceededError("VERTEX_BUDGET_USD is not set to a positive dollar amount: Vertex judging never runs unmetered.");
  return budget;
}

// Per ledger file: how far it has been read and the cost summed so far, so a check reads only new lines.
const tallies = new Map<string, { offset: number; total: number }>();

export function ledgerTotal(path = ledgerPath()): number {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    tallies.delete(path);
    return 0;
  }
  try {
    const size = fstatSync(fd).size;
    const seen = tallies.get(path);
    const { offset, total } = seen && seen.offset <= size ? seen : { offset: 0, total: 0 };
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    // A line another process is still writing is read on the next check.
    const end = buf.lastIndexOf(0x0a) + 1;
    let sum = total;
    for (const line of buf.subarray(0, end).toString("utf-8").split("\n")) {
      if (line) sum += (JSON.parse(line) as LedgerEntry).cost_usd;
    }
    tallies.set(path, { offset: offset + end, total: sum });
    return sum;
  } finally {
    closeSync(fd);
  }
}

export function appendLedger(entry: LedgerEntry, path = ledgerPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function assertUnderBudget(): void {
  const budget = budgetUsd();
  const spent = ledgerTotal();
  if (spent >= budget) {
    throw new BudgetExceededError(`Vertex ledger ${ledgerPath()} holds $${spent.toFixed(4)} of the $${budget} budget (VERTEX_BUDGET_USD): judging stops.`);
  }
}

// USD per token, from LiteLLM 1.109.1's price table, entry `vertex_ai/gemini-3.5-flash`
// (codewikibench-2026-11-15/venv-proxy/.../litellm/model_prices_and_context_window_backup.json, whose
// source is cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing): input $1.50/M,
// cached input $0.15/M, output $9.00/M, reasoning $9.00/M. The judges call the `global` endpoint,
// so the table's regional uplift does not apply. Output tokens include thinking: the Google
// provider reports outputTokens.total = candidatesTokenCount + thoughtsTokenCount.
const PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gemini-3.5-flash": { input: 1.5e-6, cachedInput: 1.5e-7, output: 9e-6 },
};

type VertexModel = Parameters<typeof wrapLanguageModel>[0]["model"];

/** `model`, with each call checked against the budget first and its cost appended to the ledger after. */
export function meteredModel(model: VertexModel, source: LedgerSource): VertexModel {
  const price = PRICES[model.modelId];
  if (!price) throw new Error(`No price for ${model.modelId}: a model is never metered at a guessed price.`);
  budgetUsd();
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({ doGenerate }) => {
        assertUnderBudget();
        const result = await doGenerate();
        const input = result.usage.inputTokens.total ?? 0;
        const cached = result.usage.inputTokens.cacheRead ?? 0;
        const output = result.usage.outputTokens.total ?? 0;
        const cost = (input - cached) * price.input + cached * price.cachedInput + output * price.output;
        appendLedger({ ts: new Date().toISOString(), source, model: model.modelId, input_tokens: input, output_tokens: output, cost_usd: cost });
        return result;
      },
      wrapStream: () => {
        throw new Error("Streaming judge calls are not metered: use generateObject or generateText.");
      },
    },
  });
}
