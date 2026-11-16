// Ported from doc0 (commit 175c6b0e) — canonical scoring copy for published benchmarks.

import { generateObject } from "ai";
import { z } from "zod";
import type { WikiPage, ReferenceWiki } from "./corpus.ts";
import { meteredJudgeModel } from "./judge-model.ts";
import { BudgetExceededError } from "./vertex-ledger.ts";

export const DIMENSIONS = ["depth", "coherence", "breadth", "citationQuality"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export type Verdict = { verdict: "worse" | "equal" | "better"; margin: number; rationale: string };
export type JudgeFn = (args: {
  dimension: Dimension; ours: string; reference: string; referenceSource: string;
  // Total page count of each wiki (NOT the sampled count). Breadth cannot be
  // judged from a capped sample — the judge needs the real totals to compare
  // subsystem coverage. Without these, a 12-page sample of a 46-page wiki looks
  // no broader than a 12-page sample of a 25-page one, flipping the verdict.
  oursPageCount: number; referencePageCount: number;
  // Which side of the blind A/B the caller wants ours shown as. Order is the
  // CALLER's choice so judgeComparative can run every cell in BOTH orders —
  // the old parity trick ((dim.length+source.length)%2) was degenerate: all
  // four dimension names have odd length, so ours was ALWAYS B vs deepwiki
  // and ALWAYS A vs zread, and position bias never cancelled.
  oursIsA: boolean;
}) => Promise<Verdict>;

/** One judge call as judgeComparative made it: its sample, whether ours was shown as Wiki A, and the ours-relative verdict, or the error. */
export type JudgeCall = { sample: number; oursIsA: boolean } & (Verdict | { error: string });
export type CellVerdict = Verdict & { margins: number[]; judgeFailures: number; unreliable: boolean; calls: JudgeCall[] };
export type JudgeSamplePage = { slug: string; title: string; chars: number; truncated: boolean };

export type ComparativeResult<D extends Dimension = Dimension> = {
  perReference: Record<string, Record<D, CellVerdict>>;
  // Partial because the field is only set for dimensions where at least one reference exists.
  // When `references` is empty the map stays {}, so callers must treat each entry as optional.
  bestPeer: Partial<Record<D, { source: string; verdict: CellVerdict }>>;
  // How many pages of each wiki the judge actually saw. The sampler caps at
  // DEFAULT_MAX_PAGES, so this surfaces e.g. "12 of our 25 vs 12 of deepwiki's
  // 46" — a reader must not assume a full-wiki comparison.
  sample: { ours: number; references: Record<string, number> };
  // The actual pages shown to the judge, for auditability.
  sampleDetail: { ours: JudgeSamplePage[]; references: Record<string, JudgeSamplePage[]> };
};

export const DEFAULT_MAX_PAGES = 12;
export const DEFAULT_PER_PAGE_CHARS = 6000;

/**
 * Build the judge digest for one wiki. PAGE-COUNT-STABLE: always samples up to
 * `maxPages` pages, each capped at `perPageChars`, instead of one global char
 * budget. The old global budget shrank the sample as pages grew longer, which
 * (a) hid added depth past the cut and (b) confounded depth with breadth —
 * lengthening OUR pages made FEWER of ours fit, so a real depth gain could read
 * as a loss. A per-page cap of ~6000 chars (~1000 words) keeps the page count
 * fixed across wikis of differing page-length AND lets the judge see depth well
 * past the old ~250-word (1500-char) cut — the truncation that made the depth
 * lever unmeasurable.
 */
export function sampleForJudge(
  pages: WikiPage[],
  maxPages = DEFAULT_MAX_PAGES,
  perPageChars = DEFAULT_PER_PAGE_CHARS,
): string {
  return pages.slice(0, maxPages).map((p) => `## ${p.title}\n${capped(p.content, perPageChars)}\n\n`).join("");
}

const capped = (content: string, perPageChars: number) =>
  content.length > perPageChars ? content.slice(0, perPageChars) + "\n…[page truncated for judge]" : content;

/** A body without its leading `# heading` when the heading repeats the title (or the title's start, as "Entry Filters" does "Entry Filters (Type, Size)"). */
function withoutRepeatedTitle(title: string, content: string): string {
  const h1 = /^# (.+)\r?\n+/.exec(content);
  return h1 !== null && title.startsWith(h1[1].trim()) ? content.slice(h1[0].length) : content;
}

/**
 * sampleForJudge's pages and per-page cap, with every page framed the same
 * way whatever its body opens with. sampleForJudge's `## <title>` frame left a
 * page whose body opens with `# Title` plainly framed and one that opens with
 * `## Overview` running into the next; this frame names each page's number and
 * section, and the repeated title heading goes before the cap applies.
 */
export function framedSampleForJudge(
  pages: WikiPage[],
  maxPages = DEFAULT_MAX_PAGES,
  perPageChars = DEFAULT_PER_PAGE_CHARS,
): string {
  return pages
    .slice(0, maxPages)
    .map((p, i) => `=== PAGE ${i + 1}: ${p.title} (section: ${p.section ?? "none"}) ===\n${capped(withoutRepeatedTitle(p.title, p.content), perPageChars)}\n\n`)
    .join("");
}

export function describeJudgeSample(
  pages: WikiPage[],
  maxPages = DEFAULT_MAX_PAGES,
  perPageChars = DEFAULT_PER_PAGE_CHARS,
): JudgeSamplePage[] {
  return pages.slice(0, maxPages).map((p) => ({
    slug: p.slug,
    title: p.title,
    chars: Math.min(p.content.length, perPageChars),
    truncated: p.content.length > perPageChars,
  }));
}

export function medianVerdict(verdicts: Verdict[]): Verdict {
  const margins = verdicts.map((x) => x.margin).sort((a, b) => a - b);
  const med = margins[Math.floor(margins.length / 2)];
  const match = verdicts.find((x) => x.margin === med);
  if (match === undefined) {
    throw new Error("No verdict found with median margin");
  }
  return {
    verdict: med < 0 ? "worse" : med > 0 ? "better" : "equal",
    margin: med,
    rationale: match.rationale,
  };
}

export function aggregateCell(
  runs: Verdict[],
  repeatMeans: number[],
  judgeFailures: number,
  totalCalls: number,
): Omit<CellVerdict, "calls"> {
  const unreliable = judgeFailures > totalCalls / 3 || repeatMeans.length === 0;
  if (unreliable) {
    return {
      verdict: "equal", margin: 0,
      rationale: `UNRELIABLE: ${judgeFailures}/${totalCalls} judge calls failed`,
      margins: repeatMeans, judgeFailures, unreliable: true,
    };
  }
  const sorted = [...repeatMeans].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const closest = runs.reduce((best, r) =>
    Math.abs(r.margin - median) < Math.abs(best.margin - median) ? r : best, runs[0]);
  return {
    verdict: median < 0 ? "worse" : median > 0 ? "better" : "equal",
    margin: median,
    rationale: closest.rationale,
    margins: repeatMeans, judgeFailures, unreliable: false,
  };
}

/**
 * Judges all four dimensions, or only those given: the generation arms leave
 * out citationQuality, which is not judged across systems. `digest` builds
 * each wiki's sample: the generation arms pass framedSampleForJudge.
 */
export async function judgeComparative(ours: WikiPage[], references: ReferenceWiki[], judge: JudgeFn, samples?: number): Promise<ComparativeResult>;
export async function judgeComparative<D extends Dimension>(
  ours: WikiPage[], references: ReferenceWiki[], judge: JudgeFn, samples: number, dimensions: readonly D[], digest?: (pages: WikiPage[]) => string,
): Promise<ComparativeResult<D>>;
export async function judgeComparative(
  ours: WikiPage[],
  references: ReferenceWiki[],
  judge: JudgeFn,
  samples = 3,
  dimensions: readonly Dimension[] = DIMENSIONS,
  digest: (pages: WikiPage[]) => string = sampleForJudge,
): Promise<ComparativeResult> {
  const oursDigest = digest(ours);
  const perReference: Record<string, Record<Dimension, CellVerdict>> = {};
  const refPagesInSample: Record<string, number> = {};

  for (const ref of references) {
    const refDigest = digest(ref.pages);
    refPagesInSample[ref.source] = Math.min(DEFAULT_MAX_PAGES, ref.pages.length);
    const byDim = {} as Record<Dimension, CellVerdict>;
    for (const dimension of dimensions) {
      const runs: Verdict[] = [];
      const repeatMeans: number[] = [];
      const calls: JudgeCall[] = [];
      let judgeFailures = 0;
      for (let sample = 0; sample < samples; sample++) {
        const pair: number[] = [];
        for (const oursIsA of [true, false]) {
          try {
            const run = await judge({
              dimension, ours: oursDigest, reference: refDigest, referenceSource: ref.source,
              oursPageCount: ours.length, referencePageCount: ref.pages.length, oursIsA,
            });
            runs.push(run);
            pair.push(run.margin);
            calls.push({ sample, oursIsA, verdict: run.verdict, margin: run.margin, rationale: run.rationale });
          } catch (err) {
            if (err instanceof BudgetExceededError) throw err;
            judgeFailures += 1;
            calls.push({ sample, oursIsA, error: err instanceof Error ? err.message : String(err) });
            console.warn(`[wiki-eval] judge call failed (${dimension} vs ${ref.source}, oursIsA=${oursIsA}):`, err);
          }
        }
        if (pair.length > 0) repeatMeans.push(pair.reduce((a, b) => a + b, 0) / pair.length);
      }
      byDim[dimension] = { ...aggregateCell(runs, repeatMeans, judgeFailures, samples * 2), calls };
    }
    perReference[ref.source] = byDim;
  }

  // Best peer per dimension = the reference we trail by the MOST (most negative
  // margin) — the toughest bar to clear, the meaningful target. Unreliable
  // cells (fabricated `margin: 0` from a mostly-failed judge run) are excluded
  // from the ranking — otherwise a judge outage on one reference can fabricate
  // a "toughest" result and mask itself as real comparative signal. If every
  // reference is unreliable for a dimension, that dimension has no bestPeer.
  const bestPeer: Partial<Record<Dimension, { source: string; verdict: CellVerdict }>> = {};
  for (const dimension of dimensions) {
    let pick: { source: string; verdict: CellVerdict } | undefined;
    for (const ref of references) {
      const verdict = perReference[ref.source][dimension];
      if (verdict.unreliable) continue;
      if (pick === undefined || verdict.margin < pick.verdict.margin) {
        pick = { source: ref.source, verdict };
      }
    }
    if (pick !== undefined) {
      bestPeer[dimension] = pick;
    }
  }

  return {
    perReference,
    bestPeer,
    sample: { ours: Math.min(DEFAULT_MAX_PAGES, ours.length), references: refPagesInSample },
    sampleDetail: {
      ours: describeJudgeSample(ours),
      references: Object.fromEntries(references.map((r) => [r.source, describeJudgeSample(r.pages)])),
    },
  };
}

const verdictSchema = z.object({
  verdict: z.enum(["worse", "equal", "better"]),
  margin: z.number().int().min(-2).max(2),
  rationale: z.string().min(1).transform((s) => s.slice(0, 400)),
});

const DIMENSION_GUIDANCE: Record<Dimension, string> = {
  depth: "Do pages explain HOW and WHY (mechanism, data flow, design intent) at length, or stay shallow?",
  coherence: "Do page topics map cleanly to real subsystems with a logical structure, or is it noisy/overlapping?",
  breadth: "Does the wiki cover the breadth of the codebase's subsystems, or leave major areas undocumented?",
  citationQuality: "Are claims backed by specific, well-placed source citations with line ranges, or sparse/absent?",
};

export const liveJudge: JudgeFn = async ({ dimension, ours, reference, oursPageCount, referencePageCount, oursIsA }) => {
  // Blind A/B comparison: the judge is NOT told which wiki is "ours", because an
  // "OUR wiki" label makes the model systematically favour it (measured: it
  // flipped grounded "worse" verdicts to "better" on depth/coherence). Order is
  // the CALLER's choice (`oursIsA`) — judgeComparative runs every cell in BOTH
  // orders and averages, so position bias cancels regardless of how any single
  // call is ordered. The A-vs-B verdict is mapped back to ours-relative-to-
  // reference afterward.
  const wikiA = oursIsA ? ours : reference;
  const wikiB = oursIsA ? reference : ours;
  const aPages = oursIsA ? oursPageCount : referencePageCount;
  const bPages = oursIsA ? referencePageCount : oursPageCount;

  const prompt = `You are comparing two auto-generated technical wikis (A and B) for the SAME code repository, on ONE dimension. You do NOT know which tool produced which wiki — judge purely on the content, with no assumption that either is better.

Dimension: ${dimension} — ${DIMENSION_GUIDANCE[dimension]}

Wiki A has ${aPages} total pages; Wiki B has ${bPages} total pages. Only a sample of up to ${DEFAULT_MAX_PAGES} pages of each is shown below. For BREADTH (subsystem coverage), weigh the TOTAL page counts and the range of subsystems documented, NOT how many pages happen to be shown in the sample. For depth, coherence, and citationQuality, judge the shown content.

Judge on substance: a wiki that explains mechanism and design intent in more depth, covers more of the codebase's subsystems, or cites specific sources more precisely is better on the relevant dimension. Denser, better-source-supported per-page explanations win on depth and citation quality; more total pages spanning more subsystems wins on breadth. Note: page LENGTH alone is not depth — a page split into many shallow sections is not deeper than a focused one. Output about WIKI A relative to WIKI B:
- verdict: "worse" | "equal" | "better" (is Wiki A worse/equal/better than Wiki B on this dimension?)
- margin: integer -2..2 (negative = A worse, 0 = equal, positive = A better; magnitude = how large the gap)
- rationale: one sentence citing the concrete difference.

=== WIKI A (sample) ===
${wikiA}

=== WIKI B (sample) ===
${wikiB}`;
  // NOTE: this call sends sampled wiki prose to whichever backend judgeModel()
  // selects — Google AI Studio (`gemini-2.5-flash`) by default, or Vertex
  // (`gemini-3.5-flash`, `global` location) when GOOGLE_VERTEX_PROJECT,
  // GOOGLE_VERTEX_CLIENT_EMAIL, and GOOGLE_VERTEX_PRIVATE_KEY are all set (see
  // judge-model.ts). Use this judge for PUBLIC repos only — pointing --repo-dir
  // at your own private clone sends that source to whichever of these two
  // external endpoints is selected.
  const { object } = await generateObject({
    model: meteredJudgeModel("arms-comparative"),
    schema: verdictSchema,
    temperature: 0.3,
    prompt,
    // Two real hangs during Phase-2 validation: an unbounded call stalls the whole eval
    // run and never reaches the judgeFailures/UNRELIABLE accounting below.
    abortSignal: AbortSignal.timeout(60_000),
  });
  // Map A-vs-B back to ours-vs-reference. When ours was shown as B, invert.
  if (oursIsA) return object;
  return {
    verdict: object.verdict === "better" ? "worse" : object.verdict === "worse" ? "better" : "equal",
    margin: -object.margin,
    rationale: object.rationale,
  };
};
