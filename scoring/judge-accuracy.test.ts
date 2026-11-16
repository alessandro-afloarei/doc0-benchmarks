// Ported from doc0 (commit 175c6b0e) — canonical scoring copy for published benchmarks.
//
// Adaptation note: the "failure accounting" test below cites a real file+line
// range to make citation resolution succeed against `repoDir: "."`. The source
// test cited `scripts/wiki-eval/eval.ts` (a doc0-internal path that doesn't
// exist in this repo) — rewritten to cite `scoring/corpus.ts:17-26`, a real
// file in this repo with enough lines. This is a fixture-data substitution
// only; the assertions and judged logic are unchanged.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractClaimCitations,
  resolveCitation,
  resolveExcerpts,
  judgeAccuracy,
  judgeClaimGroups,
  parseRef,
  parseSupportReply,
  groupClaimCitations,
  seededShuffle,
  type AccuracyJudgeFn,
  type ClaimCitation,
  type ClaimGroup,
  judgeConcurrency,
} from "./judge-accuracy.ts";
import { loadWikiDir, type WikiPage } from "./corpus.ts";

describe("extractClaimCitations", () => {
  it("parses range-in-label (ours/deepwiki) and pairs the preceding claim", () => {
    const content = "The router compiles paths at insertion time.\nSources: [src/router.ts:22-48](url), [src/x.ts:9]()";
    const pairs = extractClaimCitations(content);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ filePath: "src/router.ts", startLine: 22, endLine: 48 });
    expect(pairs[0].claim).toContain("compiles paths");
    expect(pairs[1]).toMatchObject({ filePath: "src/x.ts", startLine: 9, endLine: 9 });
  });

  it("parses range-in-URL with repo-relative path (zread trailing + inline)", () => {
    const content = [
      "Smart router picks a strategy based on the route shape at registration.",
      "Sources: [router.ts](src/router/smart-router/router.ts#L4-L10)",
      "",
      "The base app dispatches through the middleware chain [hono-base.ts#L424-L442](src/hono-base.ts#L424-L442) on each request.",
    ].join("\n");
    const pairs = extractClaimCitations(content);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ filePath: "src/router/smart-router/router.ts", startLine: 4, endLine: 10 });
    expect(pairs[1]).toMatchObject({ filePath: "src/hono-base.ts", startLine: 424, endLine: 442 });
    expect(pairs[1].claim).toContain("dispatches through the middleware chain"); // inline: claim is the link's own line
  });
});

describe("resolveCitation", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "acc-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns source text for an in-bounds range and null for out-of-bounds", async () => {
    await writeFile(join(dir, "f.ts"), "L1\nL2\nL3\n");
    expect(await resolveCitation(dir, { claim: "c", filePath: "f.ts", startLine: 1, endLine: 2 })).toContain("L1");
    expect(await resolveCitation(dir, { claim: "c", filePath: "f.ts", startLine: 9, endLine: 9 })).toBeNull();
    expect(await resolveCitation(dir, { claim: "c", filePath: "missing.ts", startLine: 1, endLine: 1 })).toBeNull();
  });
});

describe("resolveExcerpts", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "acc-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves every citation for a multi-hop claim, one header block per citation", async () => {
    await writeFile(join(dir, "a.ts"), Array.from({ length: 10 }, (_, i) => `a-line${i}`).join("\n"));
    await writeFile(join(dir, "b.ts"), Array.from({ length: 10 }, (_, i) => `b-line${i}`).join("\n"));
    const group: ClaimGroup = {
      claim: "A calls B via C",
      citations: [
        { filePath: "a.ts", startLine: 2, endLine: 3 },
        { filePath: "b.ts", startLine: 2, endLine: 3 },
      ],
    };
    const excerpt = await resolveExcerpts(dir, group);
    expect(excerpt).not.toBeNull();
    expect(excerpt).toContain("--- a.ts:2-3 ---");
    expect(excerpt).toContain("--- b.ts:2-3 ---");
  });

  it("caps the number of resolved excerpts at MAX_EXCERPTS_PER_CLAIM (5)", async () => {
    for (let i = 0; i < 7; i++) {
      await writeFile(join(dir, `f${i}.ts`), "x\n");
    }
    const group: ClaimGroup = {
      claim: "seven hops",
      citations: Array.from({ length: 7 }, (_, i) => ({ filePath: `f${i}.ts`, startLine: 1, endLine: 1 })),
    };
    const excerpt = await resolveExcerpts(dir, group);
    expect(excerpt).not.toBeNull();
    const headers = excerpt?.match(/--- f\d\.ts:1-1 ---/g) ?? [];
    expect(headers).toHaveLength(5);
    expect(excerpt).not.toContain("f5.ts");
    expect(excerpt).not.toContain("f6.ts");
  });

  it("clips a later excerpt once the MAX_EXCERPT_LINES_TOTAL (120) budget is exhausted", async () => {
    // Each raw citation resolves to 104 lines (startLine=10, endLine=109, with
    // the ±3/+2 context expansion resolveCitation applies). The first excerpt
    // fully fits (104 < 120); the second only has 16 lines of budget left.
    const big = Array.from({ length: 200 }, (_, i) => `line${i}`).join("\n");
    await writeFile(join(dir, "big1.ts"), big);
    await writeFile(join(dir, "big2.ts"), big);
    const group: ClaimGroup = {
      claim: "long chain",
      citations: [
        { filePath: "big1.ts", startLine: 10, endLine: 109 },
        { filePath: "big2.ts", startLine: 10, endLine: 109 },
      ],
    };
    const excerpt = await resolveExcerpts(dir, group);
    expect(excerpt).not.toBeNull();
    const parts = excerpt?.split("\n\n") ?? [];
    expect(parts).toHaveLength(2);
    const [first, second] = parts;
    const firstBodyLines = first.split("\n").length - 1; // minus the header line
    const secondBodyLines = second.split("\n").length - 1;
    expect(firstBodyLines).toBe(104); // fully included, well under the 120 budget
    expect(secondBodyLines).toBeLessThan(104); // clipped by the remaining budget
    expect(secondBodyLines).toBe(120 - firstBodyLines); // exactly what's left of the 120 total
  });
});

describe("judgeAccuracy", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "acc-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("computes support + resolution rates, counting a broken citation as unresolved", async () => {
    await writeFile(join(dir, "f.ts"), "real line one\nreal line two\n");
    const pages: WikiPage[] = [{
      slug: "p",
      title: "P",
      verifiedClaimRatio: null,
      // Claim text must be >=20 chars and distinct per claim — extractClaimCitations falls
      // back to an empty claim for short lines, which would collapse both citations into a
      // single claim group and defeat the per-citation resolution assertions below.
      content: "Claim A describes the parser module in detail.\nSources: [f.ts:1-2](url)\n\nClaim B describes a file that does not exist.\nSources: [gone.ts:1]()",
    }];
    const judge: AccuracyJudgeFn = async () => "supported";
    const res = await judgeAccuracy(pages, dir, judge, 40);
    expect(res.sampled).toBe(2);
    expect(res.citationResolutionRate).toBe(0.5); // f.ts resolves, gone.ts broken
    expect(res.claimSupportRate).toBe(1); // the one resolved claim judged supported
  });
});

const cit = (claim: string, filePath: string, line: number): ClaimCitation =>
  ({ claim, filePath, startLine: line, endLine: line });

describe("groupClaimCitations", () => {
  it("groups citations sharing the same claim text", () => {
    const groups = groupClaimCitations([cit("A calls B via C", "a.ts", 1), cit("A calls B via C", "b.ts", 9), cit("other", "c.ts", 2)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].citations).toHaveLength(2);
  });

  it("does not group empty-fallback claims — one single-citation group each", () => {
    // Empty claim = extraction found no substantial claim line; two such citations
    // share text only by accident and must not merge into one judged data point.
    const groups = groupClaimCitations([cit("", "a.ts", 1), cit("", "b.ts", 2)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].citations).toHaveLength(1);
    expect(groups[1].citations).toHaveLength(1);
  });
});

describe("seededShuffle", () => {
  it("is deterministic for a given seed and differs across seeds", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(arr, 42)).toEqual(seededShuffle(arr, 42));
    expect(seededShuffle(arr, 42)).not.toEqual(seededShuffle(arr, 43));
    expect([...seededShuffle(arr, 42)].sort((a, b) => a - b)).toEqual(arr);
  });
});

describe("judgeAccuracy — per-page grouping", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "acc-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps identical claim text on different pages as separate judged claims", async () => {
    await writeFile(join(dir, "a.ts"), "page one source line\n");
    await writeFile(join(dir, "b.ts"), "page two source line\n");
    // Same boilerplate claim sentence on two pages, citing unrelated files — must
    // NOT merge into one group with two citations (that collapses two data points
    // into one and feeds the judge unrelated excerpts under a single claim).
    const claim = "The middleware exposes a configurable handler entry point.";
    const pages: WikiPage[] = [
      { slug: "p1", title: "P1", verifiedClaimRatio: null, content: `${claim}\nSources: [a.ts:1](url)` },
      { slug: "p2", title: "P2", verifiedClaimRatio: null, content: `${claim}\nSources: [b.ts:1](url)` },
    ];
    const judgedExcerpts: string[] = [];
    const judge: AccuracyJudgeFn = async ({ sourceExcerpt }) => {
      judgedExcerpts.push(sourceExcerpt);
      return "supported";
    };
    const res = await judgeAccuracy(pages, dir, judge, 40, 42);
    expect(res.sampled).toBe(2); // two groups, one per page
    expect(judgedExcerpts).toHaveLength(2);
    const all = judgedExcerpts.join("\n");
    expect(all).toContain("a.ts:1-1");
    expect(all).toContain("b.ts:1-1");
    // neither judge call saw both files' excerpts merged together
    for (const e of judgedExcerpts) {
      expect(e.includes("a.ts:1-1") && e.includes("b.ts:1-1")).toBe(false);
    }
  });
});

describe("judgeAccuracy — failure accounting", () => {
  it("counts judge failures separately instead of scoring them unsupported", async () => {
    const pages = [{
      slug: "p", title: "P", verifiedClaimRatio: null,
      content: "The parser delegates to the tokenizer for splitting [a.ts:1](x/a.ts#L1)",
    }];
    // repoDir fixture: use the repo itself — cite a real file so resolution succeeds.
    const realPages = [{ ...pages[0], content: "Eval entry parses CLI args before loading corpora [scoring/corpus.ts:17-26](scoring/corpus.ts#L17-L26)" }];
    const failing = async (): Promise<"supported" | "unsupported"> => { throw new Error("api down"); };
    const res = await judgeAccuracy(realPages, ".", failing, 40, 42);
    expect(res.judgeFailures).toBe(1);
    expect(res.claimSupportRate).toBe(0); // no successful judgments — rate over zero successes
    expect(res.seed).toBe(42);
  });
});

describe("parseRef — repo:// citations", () => {
  it("a repo:// citation of a file at the repository root names the file, not the scheme", () => {
    expect(parseRef("build.rs:1-5", "repo://build.rs#L1-L5")).toEqual({ filePath: "build.rs", startLine: 1, endLine: 5 });
    expect(parseRef("Cargo.toml", "repo://Cargo.toml#L2-L9")).toEqual({ filePath: "Cargo.toml", startLine: 2, endLine: 9 });
    expect(parseRef("src/walk.rs:10-40", "repo://src/walk.rs#L10-L40")).toEqual({ filePath: "src/walk.rs", startLine: 10, endLine: 40 });
  });
});

describe("judgeAccuracy — characterization on the committed hono corpus", () => {
  // Every cited path exists with 300 lines, so ranges past 300 stay unresolved;
  // the stub judge fails on claim lengths divisible by 7 and supports even ones.
  // The expected values were computed before judgeClaimGroups shared this loop.
  it("judgeAccuracy's results on the committed hono corpus are unchanged", async () => {
    const pages = await loadWikiDir(join(dirname(fileURLToPath(import.meta.url)), "..", "corpora", "hono-2026-07"));
    const repo = await mkdtemp(join(tmpdir(), "hono-char-"));
    const paths = new Set(pages.flatMap((p) => extractClaimCitations(p.content).map((c) => c.filePath)));
    for (const p of paths) {
      await mkdir(dirname(join(repo, p)), { recursive: true });
      await writeFile(join(repo, p), Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n"));
    }
    const judge: AccuracyJudgeFn = async ({ claim }) => {
      if (claim.length % 7 === 0) throw new Error("stub outage");
      return claim.length % 2 === 0 ? "supported" : "unsupported";
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await judgeAccuracy(pages, repo, judge, 40, 42)).toEqual({ sampled: 40, claimSupportRate: 0.519, citationResolutionRate: 0.75, judgeFailures: 3, seed: 42 });
    expect(await judgeAccuracy(pages, repo, judge, 100000, 7)).toEqual({ sampled: 176, claimSupportRate: 0.529, citationResolutionRate: 0.801, judgeFailures: 22, seed: 7 });
    warn.mockRestore();
    await rm(repo, { recursive: true });
  });
});

describe("judgeClaimGroups", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "groups-"));
    await writeFile(join(repo, "a.ts"), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n"));
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  const group = (claim: string, startLine = 1, filePath = "a.ts"): ClaimGroup => ({ claim, citations: [{ filePath, startLine, endLine: startLine + 1 }] });

  it("judgeClaimGroups judges every group", async () => {
    const groups = Array.from({ length: 60 }, (_, i) => group(`claim number ${i}`, 1 + (i % 10)));
    let calls = 0;
    const score = await judgeClaimGroups(groups, repo, async () => {
      calls += 1;
      return "supported";
    });
    expect(calls).toBe(60);
    expect(score).toMatchObject({ groups: 60, resolved: 60, supported: 60, judgeFailures: 0, groundedRate: 1 });
  });

  it("an unresolved group lowers the grounded rate and leaves claimSupportRate alone", async () => {
    const groups = [group("one"), group("two"), group("three"), group("whole file", 0)];
    const score = await judgeClaimGroups(groups, repo, async () => "supported");
    expect(score).toEqual({ groups: 4, resolved: 3, supported: 3, judgeFailures: 0, groundedRate: 0.75, resolutionRate: 0.75, claimSupportRate: 1 });
  });

  it("a judge failure leaves both numerator and denominator", async () => {
    const groups = [group("ok one"), group("ok two"), group("broken"), group("missing", 1, "gone.ts")];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const score = await judgeClaimGroups(groups, repo, async ({ claim }) => {
      if (claim === "broken") throw new Error("outage");
      return claim === "ok one" ? "supported" : "unsupported";
    });
    warn.mockRestore();
    // 4 groups − 1 failure = 3 counted; 1 supported. The missing file stays in as unsupported.
    expect(score).toEqual({ groups: 4, resolved: 3, supported: 1, judgeFailures: 1, groundedRate: 1 / 3, resolutionRate: 0.75, claimSupportRate: 0.5 });
  });

  it("a failed judge call is retried once", async () => {
    const seen = new Map<string, number>();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const score = await judgeClaimGroups([group("flaky"), group("dead")], repo, async ({ claim }) => {
      const n = (seen.get(claim) ?? 0) + 1;
      seen.set(claim, n);
      if (claim === "dead" || n === 1) throw new Error("transient");
      return "supported";
    });
    warn.mockRestore();
    expect(seen).toEqual(new Map([["flaky", 2], ["dead", 2]]));
    expect(score).toMatchObject({ supported: 1, judgeFailures: 1, groundedRate: 1 });
  });

  it("a rate with nothing to divide by is null, never 0", async () => {
    expect(await judgeClaimGroups([], repo, async () => "supported")).toEqual({
      groups: 0, resolved: 0, supported: 0, judgeFailures: 0, groundedRate: null, resolutionRate: null, claimSupportRate: null,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const allFailed = await judgeClaimGroups([group("one"), group("two")], repo, async () => {
      throw new Error("outage");
    });
    warn.mockRestore();
    expect(allFailed).toMatchObject({ groups: 2, judgeFailures: 2, groundedRate: null, resolutionRate: 1, claimSupportRate: null });
  });

  it("judges at most 4 groups at a time, with the same counts as one at a time", async () => {
    const groups = Array.from({ length: 30 }, (_, i) => group(`claim ${i}`, 1 + (i % 10)));
    let running = 0;
    let peak = 0;
    const score = await judgeClaimGroups(groups, repo, async ({ claim }) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      return Number(claim.split(" ")[1]) % 3 === 0 ? "supported" : "unsupported";
    });
    expect(peak).toBe(4);
    expect(score).toMatchObject({ groups: 30, resolved: 30, supported: 10, judgeFailures: 0, groundedRate: 1 / 3 });
  });
});

describe("parseSupportReply", () => {
  it("reads exactly {supported: boolean}, a code fence around it allowed", () => {
    expect(parseSupportReply('{"supported": true}')).toBe(true);
    expect(parseSupportReply(' ```json\n{"supported": false}\n``` ')).toBe(false);
    expect(parseSupportReply('```\n{"supported":true}\n```')).toBe(true);
  });

  it("throws on anything else, so the judge call fails instead of reading unsupported", () => {
    for (const reply of ["Yes.", "", '{"supported": "true"}', '{"supported": true, "why": "x"}', '{"verdict": true}', 'Sure: {"supported": true}']) {
      expect(() => parseSupportReply(reply)).toThrow();
    }
  });
});

describe("judgeConcurrency", () => {
  it("takes a whole number from 1 to 32 and falls back to 4 otherwise", () => {
    expect(judgeConcurrency("12")).toBe(12);
    expect(judgeConcurrency(undefined)).toBe(4);
    for (const bad of ["0", "33", "2.5", "x", ""]) expect(judgeConcurrency(bad)).toBe(4);
  });
});
