import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateObject } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { judgeClaimGroups } from "./judge-accuracy.ts";
import { judgeComparative } from "./judge-comparative.ts";
import { assertUnderBudget, BudgetExceededError, ledgerTotal, meteredModel, type LedgerEntry } from "./vertex-ledger.ts";

const usage = (input: number, cached: number, output: number) => ({
  inputTokens: { total: input, noCache: input - cached, cacheRead: cached, cacheWrite: undefined },
  outputTokens: { total: output, text: undefined, reasoning: undefined },
});

function mockVertex(modelId = "gemini-3.5-flash") {
  return new MockLanguageModelV3({
    modelId,
    doGenerate: async () => ({
      content: [{ type: "text", text: '{"supported":true}' }],
      finishReason: { unified: "stop", raw: undefined },
      usage: usage(1_000_000, 200_000, 100_000),
      warnings: [],
    }),
  });
}

const ask = (model: ReturnType<typeof meteredModel>) => generateObject({ model, schema: z.object({ supported: z.boolean() }), prompt: "claim" });
const entries = (path: string): LedgerEntry[] => readFileSync(path, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry);
const line = (cost: number) => `${JSON.stringify({ ts: "t", source: "cwb", model: "m", input_tokens: 1, output_tokens: 1, cost_usd: cost })}\n`;

let ledger: string;
beforeEach(() => {
  ledger = join(mkdtempSync(join(tmpdir(), "vertex-ledger-")), "ledger.jsonl");
  vi.stubEnv("VERTEX_LEDGER", ledger);
  vi.stubEnv("VERTEX_BUDGET_USD", "5");
});
afterEach(() => vi.unstubAllEnvs());

describe("meteredModel", () => {
  it("appends each call's tokens and cost: uncached input, cached input and output (thinking included) at their own prices", async () => {
    await ask(meteredModel(mockVertex(), "arms-accuracy"));
    await ask(meteredModel(mockVertex(), "arms-comparative"));
    const [first, second] = entries(ledger);
    // 800k × $1.50/M + 200k × $0.15/M + 100k × $9/M
    expect(first).toMatchObject({ source: "arms-accuracy", model: "gemini-3.5-flash", input_tokens: 1_000_000, output_tokens: 100_000 });
    expect(first.cost_usd).toBeCloseTo(1.2 + 0.03 + 0.9, 10);
    expect(second.source).toBe("arms-comparative");
    expect(ledgerTotal()).toBeCloseTo(2 * 2.13, 10);
  });

  it("refuses a call once the ledger reaches the budget, without calling the model", async () => {
    writeFileSync(ledger, line(3) + line(2));
    const model = mockVertex();
    await expect(ask(meteredModel(model, "arms-accuracy"))).rejects.toBeInstanceOf(BudgetExceededError);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(entries(ledger)).toHaveLength(2);
  });

  it("counts what other processes append between checks", async () => {
    const model = meteredModel(mockVertex(), "arms-accuracy");
    await ask(model);
    appendFileSync(ledger, line(2.9));
    await expect(ask(model)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("refuses to run without VERTEX_BUDGET_USD", () => {
    vi.stubEnv("VERTEX_BUDGET_USD", "");
    expect(() => meteredModel(mockVertex(), "arms-accuracy")).toThrow(BudgetExceededError);
    expect(() => assertUnderBudget()).toThrow(/VERTEX_BUDGET_USD is not set/);
  });

  it("never meters a model it has no price for", () => {
    expect(() => meteredModel(mockVertex("gemini-9-pro"), "arms-accuracy")).toThrow(/No price for gemini-9-pro/);
  });
});

describe("ledgerTotal", () => {
  it("is 0 before the ledger exists, and leaves a line still being written for the next read", () => {
    expect(ledgerTotal()).toBe(0);
    writeFileSync(ledger, line(1) + line(0.5).slice(0, 20));
    expect(ledgerTotal()).toBe(1);
    appendFileSync(ledger, line(0.5).slice(20));
    expect(ledgerTotal()).toBe(1.5);
  });
});

describe("a spent budget stops the judging instead of counting as a judge failure", () => {
  const spent = async () => {
    throw new BudgetExceededError("spent");
  };

  it("in judgeClaimGroups", async () => {
    const repo = mkdtempSync(join(tmpdir(), "budget-repo-"));
    await mkdir(join(repo, "src"));
    await writeFile(join(repo, "src", "a.ts"), "export const a = 1;\nexport const b = 2;\n");
    const groups = [{ claim: "a is 1", citations: [{ filePath: "src/a.ts", startLine: 1, endLine: 2 }] }];
    await expect(judgeClaimGroups(groups, repo, spent)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("in judgeComparative", async () => {
    const page = { slug: "p", title: "P", content: "## A\nbody", verifiedClaimRatio: null };
    await expect(judgeComparative([page], [{ source: "ref", pages: [page] }], spent, 1)).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
