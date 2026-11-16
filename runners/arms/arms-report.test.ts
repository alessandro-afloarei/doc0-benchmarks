import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  armsReport,
  decideRule1,
  decideRule2,
  groundedPer1000Words,
  renderArmsReport,
  reportPaths,
  ruleInput,
  stripCitations,
  type RepoArmsReport,
  type RuleInput,
} from "./arms-report.ts";
import type { ArmMeta, ArmName } from "../../scoring/arm-corpus.ts";
import type { JudgeFn } from "../../scoring/judge-comparative.ts";
import type { ClaimGroupScore } from "../../scoring/judge-accuracy.ts";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "benchmarks", "templates", "local-generation-arms.md");

describe("stripCitations", () => {
  it("stripCitations leaves prose and labels and removes Sources lines (front matter is already gone: loadArmCorpus strips it)", () => {
    const md = [
      "## Overview", "",
      "The walker runs in [src/walk.rs:10-40](repo://src/walk.rs#L10-L40) threads, see [the docs](https://fd.dev).", "",
      "Sources: [src/walk.rs:1-9](repo://src/walk.rs#L1-L9), [src/main.rs:2-3](repo://src/main.rs#L2-L3)",
      "Sources: plain words, no link stay.",
      "Linked from [[Quickstart]].",
    ].join("\n");
    expect(stripCitations(md)).toBe([
      "## Overview", "",
      "The walker runs in src/walk.rs:10-40 threads, see [the docs](https://fd.dev).", "",
      "Sources: plain words, no link stay.",
      "Linked from [[Quickstart]].",
    ].join("\n"));
  });
});

describe("groundedPer1000Words", () => {
  it("groundedPer1000Words counts words without citations", () => {
    const score = { supported: 3 } as ClaimGroupScore;
    const pages = [{ slug: "a.md", title: "A", verifiedClaimRatio: null, content: "one two three four five six\n\nSources: [a/b.rs:1-2](repo://a/b.rs#L1-L2) [c/d.rs:1-2](repo://c/d.rs#L1-L2)" }];
    // 6 words once the Sources line is gone: 3 × 1000 / 6.
    expect(groundedPer1000Words(score, pages)).toBe(500);
    expect(groundedPer1000Words(score, [])).toBeNull();
  });
});

const arm = (grounded: number | null, per1000: number | null, tokens: number, judgeFailures = 0) => ({ grounded, per1000, tokens, judgeFailures });
const repo = (name: string, arms: RuleInput["arms"], comparative: RuleInput["comparative"] = {}): RuleInput => ({ repo: name, arms, comparative });

describe("rule 1: the map", () => {
  it("rule 1 keeps the map at +2.0 points of grounded rate and 20% more tokens, compared unrounded", () => {
    const keep = decideRule1([repo("fd", { "doc0-map": arm(0.82, 10, 120), "doc0-nomap": arm(0.8, 10, 100) })]);
    expect(keep.outcome).toBe("keep");
    expect(keep.numbers).toMatchObject({ groundedDiffPoints: 2, tokenRatio: 1.2 });
  });

  it("a pair within 2 points is undecided (second run needed): 1.967 points never rounds up to a keep", () => {
    const repos = [
      repo("hono", { "doc0-map": arm(0.82, 10, 100), "doc0-nomap": arm(0.8, 10, 100) }),
      repo("fd", { "doc0-map": arm(0.8, 10, 100), "doc0-nomap": arm(0.78, 10, 100) }),
      repo("celery", { "doc0-map": arm(0.775, 10, 100), "doc0-nomap": arm(0.756, 10, 100) }),
    ];
    expect(decideRule1(repos)).toMatchObject({ outcome: "undecided", note: "second run needed", because: expect.stringMatching(/celery/) as unknown });
    expect(decideRule1([repo("fd", { "doc0-map": arm(0.819, 10, 120), "doc0-nomap": arm(0.8, 10, 100) })])).toMatchObject({ outcome: "undecided", note: "second run needed" });
  });

  it("keeps on depth-and-breadth wins in two of three repositories, and never above 25% more tokens", () => {
    const wins = { "doc0-map~doc0-nomap": { depth: "better", breadth: "better", coherence: "worse" } } as const;
    const repos = (mapTokens: number) => [
      repo("hono", { "doc0-map": arm(0.7, 10, mapTokens), "doc0-nomap": arm(0.8, 10, 100) }, wins),
      repo("fd", { "doc0-map": arm(0.7, 10, mapTokens), "doc0-nomap": arm(0.8, 10, 100) }, wins),
      repo("celery", { "doc0-map": arm(0.7, 10, mapTokens), "doc0-nomap": arm(0.8, 10, 100) }),
    ];
    expect(decideRule1(repos(125)).outcome).toBe("keep");
    expect(decideRule1(repos(126)).outcome).toBe("remove");
  });

  it("rule 1 reads the grounded rate, not claimSupportRate", async () => {
    // doc0-map: support 0.95 on the half of its groups that resolve (grounded 0.475); doc0-nomap: grounded 0.80.
    const corpora = await fakeCorpora({
      "doc0-map": { claims: 40, resolvedClaims: 20, judge: (i) => i % 20 !== 0 },
      "doc0-nomap": { claims: 40, resolvedClaims: 40, judge: (i) => i % 5 !== 0 },
      openwiki: { claims: 4, resolvedClaims: 4, judge: () => true },
    });
    const report = await armsReport({ repos: ["fd"], date: DATE, judged: true }, corpora.deps);
    const map = report.repos[0].arms["doc0-map"].judged;
    const nomap = report.repos[0].arms["doc0-nomap"].judged;
    expect(map).toMatchObject({ claimSupportRate: 0.95, groundedRate: 0.475 });
    expect(nomap).toMatchObject({ claimSupportRate: 0.8, groundedRate: 0.8 });
    const decision = decideRule1([repo("fd", { "doc0-map": arm(map?.groundedRate ?? null, 1, 100), "doc0-nomap": arm(nomap?.groundedRate ?? null, 1, 100) })]);
    expect(decision).toMatchObject({ outcome: "remove", numbers: { groundedDiffPoints: -32.5 } });
    await corpora.cleanUp();
  });

  it("is undecided when a doc0 arm has no judged result, measured nothing, or had a judge failure", () => {
    expect(decideRule1([repo("fd", { "doc0-map": arm(0.9, 10, 100) })]).outcome).toBe("undecided");
    expect(decideRule1([repo("fd", { "doc0-map": arm(null, null, 100), "doc0-nomap": arm(0.5, 10, 100) })])).toMatchObject({
      outcome: "undecided", because: "doc0-map measured nothing on fd: no claim group to divide by.",
    });
    expect(decideRule1([repo("fd", { "doc0-map": arm(0.9, 10, 100, 1), "doc0-nomap": arm(0.5, 10, 100) })])).toMatchObject({
      outcome: "undecided", note: "re-judge", because: "doc0-map has 1 judge failure on fd.",
    });
  });
});

describe("a comparison the judge failed on decides nothing", () => {
  it("rule 1 is undecided (re-judge) when the map pair's comparison has a judge failure, even with a grounded win", () => {
    const failed = { "doc0-map~doc0-nomap": { depth: "failed", coherence: "better", breadth: "better" } } as const;
    expect(decideRule1([repo("fd", { "doc0-map": arm(0.9, 10, 100), "doc0-nomap": arm(0.8, 10, 100) }, failed)])).toMatchObject({
      outcome: "undecided",
      note: "re-judge",
      because: "the doc0-map~doc0-nomap comparison has a judge failure on fd.",
    });
  });

  it("rule 2 is undecided (re-judge) when the better arm's comparison with openwiki has a judge failure", () => {
    const failed = { "doc0-map~openwiki": { depth: "better", coherence: "failed", breadth: "better" } } as const;
    const decision = decideRule2([repo("fd", { openwiki: arm(0.7, 8, 1), "doc0-map": arm(0.85, 12, 1), "doc0-nomap": arm(0.8, 11, 1) }, failed)]);
    expect(decision).toMatchObject({ outcome: "undecided", note: "re-judge", because: "the doc0-map~openwiki comparison has a judge failure on fd." });
  });
});

describe("ruleInput", () => {
  it("reads a comparison cell with any judge failure as failed, an unreliable one as unreliable, else its verdict", () => {
    const cell = (verdict: "better" | "worse" | "equal", judgeFailures: number, unreliable: boolean) => ({ verdict, margin: 0, rationale: "", margins: [], judgeFailures, unreliable });
    const report = {
      repo: "fd",
      arms: {},
      comparative: { "doc0-map~openwiki": { depth: cell("better", 1, false), coherence: cell("equal", 0, true), breadth: cell("worse", 0, false) } },
    } as unknown as RepoArmsReport;
    expect(ruleInput(report).comparative).toEqual({ "doc0-map~openwiki": { depth: "failed", coherence: "unreliable", breadth: "worse" } });
  });
});

describe("rule 2: the landing claim", () => {
  const cells = (verdict: "better" | "worse") => ({ "doc0-map~openwiki": { depth: verdict, coherence: verdict, breadth: verdict } });

  it("allows the claim only when the better doc0 arm wins every repository on both measures and most cells", () => {
    const repos = ["hono", "fd"].map((name) => repo(name, { openwiki: arm(0.7, 8, 1), "doc0-map": arm(0.85, 12, 1), "doc0-nomap": arm(0.8, 11, 1) }, cells("better")));
    expect(decideRule2(repos)).toMatchObject({ outcome: "allowed", numbers: { betterArm: "doc0-map", comparativeWins: 6, comparativeCells: 6 } });
  });

  it("rule 2 refuses the claim when openwiki wins one repository", () => {
    const repos = [
      repo("hono", { openwiki: arm(0.7, 8, 1), "doc0-map": arm(0.85, 12, 1), "doc0-nomap": arm(0.8, 11, 1) }, cells("better")),
      repo("fd", { openwiki: arm(0.9, 14, 1), "doc0-map": arm(0.85, 12, 1), "doc0-nomap": arm(0.8, 11, 1) }, cells("better")),
    ];
    const decision = decideRule2(repos);
    expect(decision.outcome).toBe("refused");
    expect(decision.because).toMatch(/fd/);
  });

  it("rule 2 refuses the claim when doc0 has the higher grounded rate but fewer grounded claims per 1,000 words on one repository", () => {
    const repos = [
      repo("hono", { openwiki: arm(0.7, 8, 1), "doc0-map": arm(0.85, 12, 1), "doc0-nomap": arm(0.8, 11, 1) }, cells("better")),
      repo("fd", { openwiki: arm(0.7, 13, 1), "doc0-map": arm(0.85, 12, 1), "doc0-nomap": arm(0.8, 11, 1) }, cells("better")),
    ];
    expect(decideRule2(repos)).toMatchObject({ outcome: "refused" });
  });

  it("refuses without a majority of comparison cells, and is undecided when an arm has no result", () => {
    const won = repo("fd", { openwiki: arm(0.7, 8, 1), "doc0-map": arm(0.85, 12, 1), "doc0-nomap": arm(0.8, 11, 1) }, cells("worse"));
    expect(decideRule2([won])).toMatchObject({ outcome: "refused", numbers: { comparativeWins: 0 } });
    expect(decideRule2([repo("fd", { "doc0-map": arm(0.85, 12, 1), "doc0-nomap": arm(0.8, 11, 1) })]).outcome).toBe("undecided");
  });

  it("is undecided (second run needed) when the better doc0 arm sits within 2 points of openwiki, and (re-judge) on a judge failure", () => {
    const close = repo("fd", { openwiki: arm(0.84, 8, 1), "doc0-map": arm(0.85, 12, 1), "doc0-nomap": arm(0.8, 11, 1) }, cells("better"));
    expect(decideRule2([close])).toMatchObject({ outcome: "undecided", note: "second run needed" });
    const failed = repo("fd", { openwiki: arm(0.5, 8, 1, 2), "doc0-map": arm(0.85, 12, 1), "doc0-nomap": arm(0.8, 11, 1) }, cells("better"));
    expect(decideRule2([failed])).toMatchObject({ outcome: "undecided", note: "re-judge", because: "openwiki has 2 judge failures on fd." });
  });
});

// ---------------------------------------------------------------------------
// armsReport over fake corpora: a source repo with one 50-line file; each doc0
// page holds `claims` paragraphs, the first `resolvedClaims` citing lines that
// exist; openwiki gets as many Claims in its sidecar.
// ---------------------------------------------------------------------------

const DATE = "2026-11-16";

interface FakeArm { claims: number; resolvedClaims: number; judge: (i: number) => boolean; status?: "incomplete"; meta?: Partial<ArmMeta> }

function meta(armName: ArmName, extra: Partial<ArmMeta>): ArmMeta {
  return {
    schema_version: 4, system: armName === "openwiki" ? "openwiki" : "doc0", arm: armName, repo: "sharkdp/fd", credential: "api-key",
    source_repo_sha: "41532d114e2ba565fb5367d606c111b29b96450c", generated_at: "2026-11-16T00:00:00Z",
    host: "claude", model: "claude-opus-5-5", effort: "high", tool_version: "x", dry_run: true, max_pages: 3, time_cap_minutes: 60, budget_usd: 15,
    status: "complete", reason: null, page_count: 1,
    usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 },
    cost_usd: 3, duration_ms: 6 * 60_000, num_turns: 10, ...extra,
  };
}

async function fakeCorpora(arms: Partial<Record<ArmName, FakeArm>>) {
  const root = await mkdtemp(join(tmpdir(), "arms-report-"));
  const corporaDir = join(root, "corpora");
  const source = join(root, "source");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "walk.rs"), Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n"));
  const supported = new Set<string>();
  for (const [armName, spec] of Object.entries(arms) as Array<[ArmName, FakeArm]>) {
    const dir = join(corporaDir, `fd-${armName}-${DATE}`);
    await mkdir(dir, { recursive: true });
    const statements = Array.from({ length: spec.claims }, (_, i) => `${armName} claim number ${i} about the walker.`);
    statements.forEach((s, i) => spec.judge(i) && supported.add(s));
    const line = (i: number) => (i < spec.resolvedClaims ? 1 + (i % 40) : 900);
    if (armName === "openwiki") {
      await writeFile(join(dir, "walk.md"), "---\ntitle: Walk\n---\n# Walk\n\nThe walker.\n");
      await mkdir(join(dir, "_claims"));
      await writeFile(join(dir, "_claims", "walk.json"), JSON.stringify({
        schemaVersion: 1,
        claims: statements.map((statement, i) => ({ id: `c${i}`, statement, evidence: [{ resource: `repo://src/walk.rs#L${line(i)}-L${line(i) + 2}`, version: "v" }] })),
      }));
    } else {
      const body = statements.map((s, i) => `${s}\n\nSources: [src/walk.rs:${line(i)}-${line(i) + 2}](repo://src/walk.rs#L${line(i)}-L${line(i) + 2})`).join("\n\n");
      await writeFile(join(dir, "walk.md"), `---\ntitle: "Walk"\n---\n## Overview\n\n${body}\n`);
    }
    await writeFile(join(dir, "_meta.json"), JSON.stringify(meta(armName, { ...(spec.status ? { status: "incomplete", reason: "time cap 60 min", page_count: 0, usage: null, cost_usd: null, num_turns: null } : {}), ...spec.meta })));
  }
  const comparativeCalls: Array<Parameters<JudgeFn>[0]> = [];
  const deps = {
    corporaDir,
    sourceDir: async () => source,
    accuracyJudge: async ({ claim }: { claim: string }) => (supported.has(claim) ? "supported" as const : "unsupported" as const),
    // A judge that always prefers whichever wiki it reads first: pure position bias.
    comparativeJudge: (async (args) => {
      comparativeCalls.push(args);
      return args.oursIsA ? { verdict: "better", margin: 1, rationale: "A reads better" } : { verdict: "worse", margin: -1, rationale: "A reads better" };
    }) satisfies JudgeFn,
    judgeName: "stub-judge",
  };
  return { deps, comparativeCalls, cleanUp: () => rm(root, { recursive: true, force: true }) };
}

describe("armsReport", () => {
  it("an incomplete arm is listed and never scored", async () => {
    const corpora = await fakeCorpora({
      openwiki: { claims: 4, resolvedClaims: 4, judge: () => true },
      "doc0-map": { claims: 4, resolvedClaims: 4, judge: () => true, status: "incomplete" },
      "doc0-nomap": { claims: 4, resolvedClaims: 4, judge: () => true },
    });
    const report = await armsReport({ repos: ["fd"], date: DATE, judged: true }, corpora.deps);
    const cell = report.repos[0].arms["doc0-map"];
    expect(cell).toMatchObject({ status: "incomplete", reason: "time cap 60 min" });
    expect(cell.judged).toBeUndefined();
    expect(cell.deterministic).toBeUndefined();
    expect(Object.keys(report.repos[0].comparative)).toEqual(["doc0-nomap~openwiki"]);
    const markdown = renderArmsReport(report, await readFile(TEMPLATE, "utf-8"));
    expect(markdown).toMatch(/\| fd \| doc0-map \| time cap 60 min \|/);
    // A run with no final result spent an unknown amount, never $0.
    expect(markdown).toMatch(/\| fd \| doc0-map \| incomplete \| 0 \| unknown \| unknown \| unknown \| unknown \| unknown \| unknown \|/);
    await corpora.cleanUp();
  });

  it("a missing arm folder reads as an incomplete arm", async () => {
    const corpora = await fakeCorpora({ openwiki: { claims: 2, resolvedClaims: 2, judge: () => true } });
    const report = await armsReport({ repos: ["fd"], date: DATE, judged: false }, corpora.deps);
    expect(report.repos[0].arms["doc0-map"]).toMatchObject({ status: "incomplete", reason: `no corpus at fd-doc0-map-${DATE}` });
    await corpora.cleanUp();
  });

  it("comparative runs both orders for every pair", async () => {
    const corpora = await fakeCorpora({
      openwiki: { claims: 2, resolvedClaims: 2, judge: () => true },
      "doc0-map": { claims: 2, resolvedClaims: 2, judge: () => true },
      "doc0-nomap": { claims: 2, resolvedClaims: 2, judge: () => true },
    });
    const report = await armsReport({ repos: ["fd"], date: DATE, judged: true }, corpora.deps);
    const calls = corpora.comparativeCalls;
    // 3 pairs × 3 dimensions × 3 samples × 2 orders.
    expect(calls).toHaveLength(54);
    for (const [, ref] of [["doc0-map", "openwiki"], ["doc0-nomap", "openwiki"], ["doc0-map", "doc0-nomap"]]) {
      for (const dimension of ["depth", "coherence", "breadth"] as const) {
        const cell = calls.filter((c) => c.referenceSource === ref && c.dimension === dimension);
        expect(cell.filter((c) => c.oursIsA)).toHaveLength(cell.length / 2);
      }
    }
    expect(calls.some((c) => (c.dimension as string) === "citationQuality")).toBe(false);
    expect(calls.some((c) => /repo:\/\/|Sources:/.test(c.ours + c.reference))).toBe(false);
    // Both systems' pages are framed the same way, and openwiki's `# Walk` that repeats the title is gone.
    const openwikiDigest = calls.find((c) => c.referenceSource === "openwiki")?.reference;
    expect(openwikiDigest).toBe("=== PAGE 1: Walk (section: none) ===\nThe walker.\n\n");
    expect(calls[0]?.ours.startsWith("=== PAGE 1: Walk (section: none) ===\n## Overview")).toBe(true);
    expect(Object.keys(report.repos[0].comparative).sort()).toEqual(["doc0-map~doc0-nomap", "doc0-map~openwiki", "doc0-nomap~openwiki"]);
    await corpora.cleanUp();
  });

  it("an unjudged dry run fills usage and deterministic metrics and applies no rule", async () => {
    const corpora = await fakeCorpora({
      openwiki: { claims: 2, resolvedClaims: 2, judge: () => true },
      "doc0-map": { claims: 2, resolvedClaims: 2, judge: () => true },
      "doc0-nomap": { claims: 2, resolvedClaims: 2, judge: () => true },
    });
    const report = await armsReport({ repos: ["fd"], date: DATE, judged: false }, corpora.deps);
    const cell = report.repos[0].arms.openwiki;
    expect(cell).toMatchObject({ status: "complete", totalTokens: 150, costPerPage: 3, minutesPerPage: 6 });
    expect(cell.deterministic?.pages).toBe(1);
    expect(report.decisions.rule1).toMatchObject({ outcome: "not applied", note: "dry run" });
    expect(report.decisions.rule2).toMatchObject({ outcome: "not applied", note: "dry run" });
    expect(report.dry_run).toBe(true);
    // Dry run: the largest minutes per page among the arms sets the full run's caps, and cost per page projects its cost.
    expect(report.projection).toMatchObject({ minutesPerPage: 6, timeCaps: { hono: 276, fd: 222, celery: 420 } });
    expect(report.projection?.costUsd.fd).toEqual({ openwiki: 69, "doc0-map": 69, "doc0-nomap": 69 });
    await corpora.cleanUp();
  });
});

describe("armsReport keeps every judge call", () => {
  it("stores each cell's raw calls and shows the means with A shown first and with B shown first beside the verdict", async () => {
    const all = { claims: 2, resolvedClaims: 2, judge: () => true };
    const corpora = await fakeCorpora({ openwiki: all, "doc0-map": all, "doc0-nomap": all });
    const report = await armsReport({ repos: ["fd"], date: DATE, judged: true }, corpora.deps);
    const cell = report.repos[0].comparative["doc0-map~openwiki"]?.depth;
    expect(cell?.calls).toHaveLength(6);
    expect(cell?.calls[1]).toEqual({ sample: 0, oursIsA: false, verdict: "worse", margin: -1, rationale: "A reads better" });
    const markdown = renderArmsReport(report, await readFile(TEMPLATE, "utf-8"));
    expect(markdown).toContain("| fd | doc0-map | openwiki | equal (+0; A first +1, B first -1) | equal (+0; A first +1, B first -1) | equal (+0; A first +1, B first -1) |");
    await corpora.cleanUp();
  });
});

describe("a labelled report", () => {
  it("is written under its label, beside the report it re-judges, never over it", () => {
    expect(reportPaths("/b", "2026-11-15-full", null, false)).toEqual({ json: "/b/results/arms-2026-11-15-full.json", markdown: "/b/docs/benchmarks/2026-11-15-full-local-generation-arms.md" });
    expect(reportPaths("/b", "2026-11-15-full", "instrument-v2", false)).toEqual({
      json: "/b/results/arms-2026-11-15-full-instrument-v2.json", markdown: "/b/docs/benchmarks/2026-11-15-full-instrument-v2-local-generation-arms.md",
    });
    expect(reportPaths("/b", "2026-11-15", null, true).markdown).toBe("/b/docs/benchmarks/2026-11-15-local-generation-arms-DRY-RUN.md");
  });

  it("names its label in the title", async () => {
    const corpora = await fakeCorpora({ "doc0-map": { claims: 1, resolvedClaims: 1, judge: () => true } });
    const report = await armsReport({ repos: ["fd"], date: DATE, judged: false, label: "instrument-v2" }, corpora.deps);
    expect(report.label).toBe("instrument-v2");
    expect(renderArmsReport(report, await readFile(TEMPLATE, "utf-8"))).toMatch(/^# Local generation arms, 2026-11-16, instrument-v2 \(DRY RUN\)/);
    await corpora.cleanUp();
  });
});

describe("armsReport refuses or holds back", () => {
  const all = { claims: 2, resolvedClaims: 2, judge: () => true };
  const full = { dry_run: false, max_pages: null };

  it("a full run on fewer repositories than the rules name applies no rule", async () => {
    const corpora = await fakeCorpora({ openwiki: { ...all, meta: full }, "doc0-map": { ...all, meta: full }, "doc0-nomap": { ...all, meta: full } });
    const report = await armsReport({ repos: ["fd"], date: DATE, judged: true }, corpora.deps);
    expect(report.dry_run).toBe(false);
    expect(report.decisions.rule1).toMatchObject({ outcome: "not applied", note: "needs hono, fd, celery" });
    const markdown = renderArmsReport(report, await readFile(TEMPLATE, "utf-8"));
    expect(markdown).toContain("**Rule 1, the map: not applied (needs hono, fd, celery).**");
    await corpora.cleanUp();
  });

  it("refuses to compare arms made differently, naming the setting", async () => {
    for (const [field, value] of [["host", "codex"], ["model", "claude-haiku-5-5"], ["credential", "subscription"], ["budget_usd", 2], ["max_pages", 1], ["effort", "low"], ["time_cap_minutes", 30], ["source_repo_sha", "0".repeat(40)]] as const) {
      const corpora = await fakeCorpora({ openwiki: all, "doc0-map": { ...all, meta: { [field]: value } }, "doc0-nomap": all });
      await expect(armsReport({ repos: ["fd"], date: DATE, judged: false }, corpora.deps)).rejects.toThrow(`fd: the arms differ in ${field}`);
      await corpora.cleanUp();
    }
  });

  it("refuses a corpus whose meta names another arm or repository", async () => {
    const corpora = await fakeCorpora({ openwiki: all, "doc0-map": { ...all, meta: { arm: "doc0-nomap" } } });
    await expect(armsReport({ repos: ["fd"], date: DATE, judged: false }, corpora.deps)).rejects.toThrow(/fd-doc0-map-2026-11-16 holds the doc0-nomap arm/);
    await corpora.cleanUp();
  });
});

describe("renderArmsReport", () => {
  it("keeps the template's decision rules verbatim and fills every placeholder", async () => {
    const template = await readFile(TEMPLATE, "utf-8");
    const corpora = await fakeCorpora({
      openwiki: { claims: 2, resolvedClaims: 1, judge: () => true },
      "doc0-map": { claims: 2, resolvedClaims: 2, judge: () => true },
      "doc0-nomap": { claims: 2, resolvedClaims: 2, judge: () => false },
    });
    const report = await armsReport({ repos: ["fd"], date: DATE, judged: true }, corpora.deps);
    const markdown = renderArmsReport(report, template);
    const rules = template.slice(template.indexOf("## The decision rules"), template.indexOf("## Decisions"));
    expect(markdown).toContain(rules);
    expect(markdown).not.toMatch(/\{\{\w+\}\}/);
    expect(markdown).toMatch(/^# Local generation arms, 2026-11-16 \(DRY RUN\)/);
    expect(markdown).toContain("DRY RUN: 3 pages per arm: tests the harness, decides nothing.");
    expect(markdown).toMatch(/\| fd \| openwiki \| 0\.5 \| 250 \| 0\.5 \| 1 \| 0 \|/);
    expect(markdown).toContain("**Rule 1, the map: not applied (dry run).**");
    expect(markdown).toContain("Host `claude`, model `claude-opus-5-5`, effort `high`, credential `api-key`.");
    expect(markdown).toContain("a subscription run's `total_cost_usd` is Claude Code's API-equivalent figure, not money charged");
    await corpora.cleanUp();
  });

  it("shows a run's cost to the cent, as claude's float leaves it", async () => {
    const corpora = await fakeCorpora({ "doc0-map": { claims: 1, resolvedClaims: 1, judge: () => true, meta: { cost_usd: 1.5631926000000003 } } });
    const markdown = renderArmsReport(await armsReport({ repos: ["fd"], date: DATE, judged: false }, corpora.deps), await readFile(TEMPLATE, "utf-8"));
    expect(markdown).toContain("| 1.56 |");
    expect(markdown).not.toContain("1.5631926");
    await corpora.cleanUp();
  });

  it("the template holds the plan's decision rules", async () => {
    const template = await readFile(TEMPLATE, "utf-8");
    for (const phrase of [
      "it never leaves the denominator",
      "by at least 2 percentage points of mean grounded rate",
      "costs at most 25% more total tokens",
      "more grounded claims per 1,000 words than openwiki on every repository",
      "wins the blind comparison on a majority of dimension-repository cells",
      "it is never re-run selectively for one arm",
    ]) expect(template).toContain(phrase);
    const note = template.slice(0, template.indexOf("## The decision rules"));
    expect(note).toContain("one proposition per Claim");
    expect(note).toContain("the owner settles it before the full run");
  });
});
