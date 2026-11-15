// The three-arm report: per repository and arm, usage, deterministic metrics
// and (with --judged) the full-population grounded rate and the blind
// comparison of every arm pair; then the decision rules the report template
// fixed before any run.
//
// Usage:
//   pnpm bench:arms --repos fd[,hono,celery] --date 2026-11-16 [--judged]
// Writes results/arms-<date>.json and docs/benchmarks/<date>-local-generation-arms[-DRY-RUN].md.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { ensureSourceAt, requireJudgeCredentials } from "../grounding-scorecard.ts";
import { ARM_SETTINGS, loadArmCorpus, readArmMeta, type ArmCorpus, type ArmMeta, type ArmName } from "../../scoring/arm-corpus.ts";
import type { WikiPage } from "../../scoring/corpus.ts";
import { judgeClaimGroups, LINK, liveAccuracyJudge, parseRef, type AccuracyJudgeFn, type ClaimGroupScore } from "../../scoring/judge-accuracy.ts";
import { judgeComparative, liveJudge, type CellVerdict, type JudgeFn } from "../../scoring/judge-comparative.ts";
import { judgeModel } from "../../scoring/judge-model.ts";
import { computeStructuralMetrics, wordCount, type StructuralMetrics } from "../../scoring/metrics.ts";
import { ARM_REPOS, ARMS, capMinutes, CLOUD_PAGE_COUNTS, REPOS, type RepoName } from "./arms.ts";
import { CORPORA_ARMS_DIR } from "./run-arm.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATE = join(ROOT, "docs", "benchmarks", "templates", "local-generation-arms.md");

/** citationQuality is left out: the bodies are compared with their citations stripped. */
export const ARM_DIMENSIONS = ["depth", "coherence", "breadth"] as const;
export type ArmDimension = (typeof ARM_DIMENSIONS)[number];
/** Each pair is judged with its first arm as "ours": a `better` verdict is a win for the first. */
export const PAIRS = [["doc0-map", "openwiki"], ["doc0-nomap", "openwiki"], ["doc0-map", "doc0-nomap"]] as const;
export type PairKey = `${(typeof PAIRS)[number][0]}~${(typeof PAIRS)[number][1]}`;

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

const HAS_LINK = /\[[^\]]*\]\([^)]*\)/;

/** A page body (front matter already gone) without what only cites: `Sources:` lines holding a link, and citation links (their label stays). */
export function stripCitations(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => !(/^\s*Sources:/.test(line) && HAS_LINK.test(line)))
    .join("\n")
    .replace(LINK, (link, label: string, url: string) => (url.startsWith("repo://") || parseRef(label, url) !== null ? label : link));
}

/** For display only: every comparison reads the unrounded value. */
const round = (n: number, digits: number) => Number(n.toFixed(digits));

/** Supported groups per 1,000 words of the arm's page bodies, citations stripped (unrounded); null with no words to divide by. */
export function groundedPer1000Words(score: Pick<ClaimGroupScore, "supported">, pages: WikiPage[]): number | null {
  const words = pages.reduce((sum, p) => sum + wordCount(stripCitations(p.content)), 0);
  return words === 0 ? null : (score.supported * 1000) / words;
}

// ---------------------------------------------------------------------------
// Decision rules (the template states them; these apply them)
// ---------------------------------------------------------------------------

interface RuleArm { grounded: number | null; per1000: number | null; tokens: number | null; judgeFailures: number }

export interface RuleInput {
  repo: string;
  /** Only arms that completed and were judged. */
  arms: Partial<Record<ArmName, RuleArm>>;
  comparative: Partial<Record<PairKey, Partial<Record<ArmDimension, CellVerdict["verdict"] | "unreliable">>>>;
}

export interface Decision {
  outcome: "keep" | "remove" | "allowed" | "refused" | "undecided" | "not applied";
  /** Why a rule decided nothing: "re-judge", "second run needed", "dry run", "needs …". */
  note?: string;
  because: string;
  numbers: Record<string, number | string>;
}

interface Measured { grounded: number; per1000: number; tokens: number }

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Two points of rate, with room for float error: 0.82 − 0.80 is 0.0199999…, and is 2 points. */
const TWO_POINTS = 0.02 - 1e-9;
const points = (diff: number) => round(diff * 100, 1);

const undecided = (because: string, note?: string): Decision => ({ outcome: "undecided", ...(note ? { note } : {}), because, numbers: {} });

/**
 * Each repository's measured cells for `arms`, or why the rule decides
 * nothing: an arm without a judged result, one the judge failed on (the
 * instrument's fault: re-judge), or one with nothing to divide by.
 */
function measuredCells<A extends ArmName>(repos: RuleInput[], arms: readonly A[]): Array<RuleInput & { cells: Record<A, Measured> }> | Decision {
  if (repos.length === 0) return undecided("no repository ran.");
  const missing = repos.filter((r) => arms.some((a) => r.arms[a] === undefined)).map((r) => r.repo);
  if (missing.length > 0) return undecided(`${arms.join(" or ")} has no judged result on ${missing.join(", ")}.`);
  const rows: Array<RuleInput & { cells: Record<A, Measured> }> = [];
  for (const r of repos) {
    const cells = {} as Record<A, Measured>;
    for (const a of arms) {
      const { grounded, per1000, tokens, judgeFailures } = r.arms[a] as RuleArm;
      if (judgeFailures > 0) return undecided(`${a} has ${judgeFailures} judge failure${judgeFailures === 1 ? "" : "s"} on ${r.repo}.`, "re-judge");
      if (grounded === null || per1000 === null || tokens === null) return undecided(`${a} measured nothing on ${r.repo}: no claim group to divide by.`);
      cells[a] = { grounded, per1000, tokens };
    }
    rows.push({ ...r, cells });
  }
  return rows;
}

/** Owner question 5: a pair within 2 points of grounded rate gets a second run of both arms before a rule is applied. */
function closePairs<A extends ArmName>(rows: Array<{ repo: string; cells: Record<A, Measured> }>, a: A, b: A): Decision | null {
  const close = rows.filter((r) => Math.abs(r.cells[a].grounded - r.cells[b].grounded) < TWO_POINTS);
  if (close.length === 0) return null;
  const pairs = close.map((r) => `${r.repo} (${points(r.cells[a].grounded - r.cells[b].grounded)} points)`);
  return undecided(`${a} and ${b} are within 2 points of grounded rate on ${pairs.join(", ")}: both arms run again there first.`, "second run needed");
}

/** Rule 1: the map stays in doc0_begin. */
export function decideRule1(repos: RuleInput[]): Decision {
  const both = measuredCells(repos, ["doc0-map", "doc0-nomap"] as const);
  if (!Array.isArray(both)) return both;
  const close = closePairs(both, "doc0-map", "doc0-nomap");
  if (close) return close;
  const groundedDiff = mean(both.map((b) => b.cells["doc0-map"].grounded)) - mean(both.map((b) => b.cells["doc0-nomap"].grounded));
  const comparativeWins = both.filter((b) => b.comparative["doc0-map~doc0-nomap"]?.depth === "better" && b.comparative["doc0-map~doc0-nomap"]?.breadth === "better").length;
  const comparativeWinsNeeded = Math.ceil((2 * both.length) / 3);
  const mapTokens = sum(both.map((b) => b.cells["doc0-map"].tokens));
  const nomapTokens = sum(both.map((b) => b.cells["doc0-nomap"].tokens));
  const tokensWithin = 4 * mapTokens <= 5 * nomapTokens; // at most 25% more, in integers
  const better = groundedDiff >= TWO_POINTS || comparativeWins >= comparativeWinsNeeded;
  const groundedDiffPoints = points(groundedDiff);
  const numbers = { groundedDiffPoints, comparativeWins, comparativeWinsNeeded, tokenRatio: nomapTokens === 0 ? "n/a" : round(mapTokens / nomapTokens, 3) };
  return {
    outcome: better && tokensWithin ? "keep" : "remove",
    because:
      `doc0-map ${groundedDiffPoints >= 0 ? "+" : ""}${groundedDiffPoints} points of mean grounded rate (needs +2.0), ` +
      `depth-and-breadth wins in ${comparativeWins} of ${both.length} repositories (needs ${comparativeWinsNeeded}), ` +
      `${numbers.tokenRatio}× doc0-nomap's tokens (at most 1.25).`,
    numbers,
  };
}

/** Rule 2: the landing page may say doc0's generation beats openwiki. */
export function decideRule2(repos: RuleInput[]): Decision {
  const all = measuredCells(repos, ["openwiki", "doc0-map", "doc0-nomap"] as const);
  if (!Array.isArray(all)) return all;
  const betterArm = mean(all.map((a) => a.cells["doc0-map"].grounded)) >= mean(all.map((a) => a.cells["doc0-nomap"].grounded)) ? "doc0-map" : "doc0-nomap";
  const close = closePairs(all, betterArm, "openwiki");
  if (close) return close;
  const lost = all.filter((a) => !(a.cells[betterArm].grounded > a.cells.openwiki.grounded && a.cells[betterArm].per1000 > a.cells.openwiki.per1000)).map((a) => a.repo);
  const comparativeCells = all.length * ARM_DIMENSIONS.length;
  const comparativeWins = all.reduce((n, a) => n + ARM_DIMENSIONS.filter((d) => a.comparative[`${betterArm}~openwiki`]?.[d] === "better").length, 0);
  const majority = comparativeWins * 2 > comparativeCells;
  return {
    outcome: lost.length === 0 && majority ? "allowed" : "refused",
    because:
      `${betterArm} (the better doc0 arm by mean grounded rate) ` +
      (lost.length === 0 ? "beats openwiki on grounded rate and grounded claims per 1,000 words on every repository" : `does not beat openwiki on both measures on ${lost.join(", ")}`) +
      `; it wins ${comparativeWins} of ${comparativeCells} comparison cells (needs more than half).`,
    numbers: { betterArm, repositoriesLost: lost.join(", ") || "none", comparativeWins, comparativeCells },
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface ArmCell {
  arm: ArmName;
  status: "complete" | "incomplete";
  reason: string | null;
  meta: ArmMeta | null;
  pageCount: number;
  /** null: the run ended without claude's final result, so its spend is unknown. */
  totalTokens: number | null;
  costUsd: number | null;
  minutes: number;
  costPerPage: number | null;
  minutesPerPage: number | null;
  deterministic?: StructuralMetrics;
  judged?: ClaimGroupScore & { groundedPer1000Words: number | null };
}

export interface RepoArmsReport {
  repo: RepoName;
  arms: Record<ArmName, ArmCell>;
  comparative: Partial<Record<PairKey, Record<ArmDimension, CellVerdict>>>;
}

export interface Projection {
  /** The largest minutes per page among the dry run's complete arms: m in capMinutes. */
  minutesPerPage: number;
  timeCaps: Record<RepoName, number>;
  /** Cost per page × the repository's cloud page count, per arm. */
  costUsd: Record<RepoName, Partial<Record<ArmName, number>>>;
}

export interface ArmsReport {
  schema_version: 1;
  date: string;
  dry_run: boolean;
  judged: boolean;
  judge: string | null;
  repos: RepoArmsReport[];
  decisions: { rule1: Decision; rule2: Decision };
  projection: Projection | null;
}

export interface ArmsReportDeps {
  corporaDir?: string;
  sourceDir?: (repo: RepoName) => Promise<string>;
  accuracyJudge?: AccuracyJudgeFn;
  comparativeJudge?: JudgeFn;
  judgeName?: string;
}

function usageCell(arm: ArmName, meta: ArmMeta | null, reason: string | null): ArmCell {
  const u = meta?.usage ?? null;
  const pageCount = meta?.page_count ?? 0;
  const costUsd = meta?.cost_usd ?? null;
  const minutes = (meta?.duration_ms ?? 0) / 60_000;
  return {
    arm, status: meta?.status ?? "incomplete", reason, meta, pageCount,
    totalTokens: u ? u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens + u.output_tokens : null,
    costUsd, minutes: round(minutes, 1),
    costPerPage: pageCount === 0 || costUsd === null ? null : round(costUsd / pageCount, 2),
    minutesPerPage: pageCount === 0 ? null : round(minutes / pageCount, 2),
  };
}

/** Throws unless every arm in `metas` was made the same way (ARM_SETTINGS), naming the first setting that differs. */
function requireSameSettings(scope: string, metas: Array<{ arm: ArmName; meta: ArmMeta }>, settings: ReadonlyArray<(typeof ARM_SETTINGS)[number]>): void {
  for (const field of settings) {
    const values = new Set(metas.map(({ meta }) => JSON.stringify(meta[field])));
    if (values.size > 1) {
      throw new Error(`${scope}: the arms differ in ${field} (${metas.map(({ arm, meta }) => `${arm} ${JSON.stringify(meta[field])}`).join(", ")}): compare only arms run the same way.`);
    }
  }
}

const exists = (path: string) => stat(path).then(() => true, () => false);
const stripped = (pages: WikiPage[]) => pages.map((p) => ({ ...p, content: stripCitations(p.content) }));

function ruleInput(r: RepoArmsReport): RuleInput {
  const arms: RuleInput["arms"] = {};
  for (const cell of Object.values(r.arms)) {
    if (cell.judged) arms[cell.arm] = { grounded: cell.judged.groundedRate, per1000: cell.judged.groundedPer1000Words, tokens: cell.totalTokens, judgeFailures: cell.judged.judgeFailures };
  }
  const comparative: RuleInput["comparative"] = {};
  for (const [pair, byDim] of Object.entries(r.comparative) as Array<[PairKey, Record<ArmDimension, CellVerdict>]>) {
    comparative[pair] = Object.fromEntries(ARM_DIMENSIONS.map((d) => [d, byDim[d].unreliable ? "unreliable" : byDim[d].verdict]));
  }
  return { repo: r.repo, arms, comparative };
}

function projection(repos: RepoArmsReport[]): Projection | null {
  const cells = repos.flatMap((r) => Object.values(r.arms)).filter((c) => c.status === "complete" && c.meta && c.pageCount > 0);
  if (cells.length === 0) return null;
  const perPage = (c: ArmCell) => (c.meta?.duration_ms ?? 0) / 60_000 / c.pageCount;
  const m = Math.max(...cells.map(perPage));
  const costUsd = Object.fromEntries(REPOS.map((repo) => [repo, Object.fromEntries(ARMS.flatMap((arm) => {
    const own = cells.filter((c) => c.arm === arm).flatMap((c) => (c.costUsd === null ? [] : [c.costUsd / c.pageCount]));
    return own.length === 0 ? [] : [[arm, round(mean(own) * CLOUD_PAGE_COUNTS[repo], 2)]];
  }))])) as Projection["costUsd"];
  return { minutesPerPage: round(m, 2), timeCaps: Object.fromEntries(REPOS.map((repo) => [repo, capMinutes(m, CLOUD_PAGE_COUNTS[repo])])) as Record<RepoName, number>, costUsd };
}

export async function armsReport(o: { repos: RepoName[]; date: string; judged: boolean }, deps: ArmsReportDeps = {}): Promise<ArmsReport> {
  const {
    corporaDir = CORPORA_ARMS_DIR,
    sourceDir = (repo: RepoName) => ensureSourceAt(ARM_REPOS[repo].repo, ARM_REPOS[repo].sha, `arms-${repo}`),
    accuracyJudge = liveAccuracyJudge,
    comparativeJudge = liveJudge,
  } = deps;
  const repos: RepoArmsReport[] = [];
  const allMetas: Array<{ arm: ArmName; meta: ArmMeta }> = [];
  for (const repo of o.repos) {
    const arms = {} as Record<ArmName, ArmCell>;
    const complete = new Map<ArmName, ArmCorpus>();
    const metas: Array<{ arm: ArmName; meta: ArmMeta }> = [];
    for (const arm of ARMS) {
      const name = `${repo}-${arm}-${o.date}`;
      if (!(await exists(join(corporaDir, name, "_meta.json")))) {
        arms[arm] = usageCell(arm, null, `no corpus at ${name}`);
        continue;
      }
      const meta = await readArmMeta(join(corporaDir, name));
      if (meta.arm !== arm || meta.repo !== ARM_REPOS[repo].repo) throw new Error(`${name} holds the ${meta.arm} arm of ${meta.repo}: its folder name says otherwise.`);
      metas.push({ arm, meta });
      arms[arm] = usageCell(arm, meta, meta.reason);
      if (meta.status !== "complete") continue;
      const corpus = await loadArmCorpus(join(corporaDir, name));
      complete.set(arm, corpus);
      arms[arm].deterministic = await computeStructuralMetrics(corpus.pages);
    }
    requireSameSettings(repo, metas, ARM_SETTINGS);
    allMetas.push(...metas);
    const comparative: RepoArmsReport["comparative"] = {};
    if (o.judged && complete.size > 0) {
      const source = await sourceDir(repo);
      for (const [arm, corpus] of complete) {
        const score = await judgeClaimGroups(corpus.claimGroups, source, accuracyJudge);
        arms[arm].judged = { ...score, groundedPer1000Words: groundedPer1000Words(score, corpus.pages) };
      }
      for (const [a, b] of PAIRS) {
        const ours = complete.get(a);
        const reference = complete.get(b);
        if (!ours || !reference) continue;
        const result = await judgeComparative(stripped(ours.pages), [{ source: b, pages: stripped(reference.pages) }], comparativeJudge, 3, ARM_DIMENSIONS);
        comparative[`${a}~${b}`] = result.perReference[b];
      }
    }
    repos.push({ repo, arms, comparative });
  }
  // A time cap and the source SHA belong to a repository; everything else is shared by the whole run.
  requireSameSettings("the run", allMetas, ARM_SETTINGS.filter((f) => f !== "time_cap_minutes" && f !== "source_repo_sha"));
  const dryRun = allMetas.some(({ meta }) => meta.dry_run);
  const inputs = repos.map(ruleInput);
  const missingRepos = REPOS.filter((r) => !o.repos.includes(r));
  const notApplied = (note: string): Decision => ({ outcome: "not applied", note, because: "The rules apply only to a full run on every repository.", numbers: {} });
  const held = dryRun ? notApplied("dry run") : missingRepos.length > 0 ? notApplied(`needs ${REPOS.join(", ")}`) : null;
  const model = o.judged ? (deps.judgeName ?? judgeModel()) : null;
  return {
    schema_version: 1, date: o.date, dry_run: dryRun, judged: o.judged,
    judge: model === null ? null : typeof model === "string" ? model : model.modelId,
    repos,
    decisions: held ? { rule1: held, rule2: held } : { rule1: decideRule1(inputs), rule2: decideRule2(inputs) },
    projection: dryRun ? projection(repos) : null,
  };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const table = (header: string[], rows: Array<Array<string | number>>) =>
  [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const cellsOf = (report: ArmsReport) => report.repos.flatMap((r) => ARMS.map((arm) => ({ repo: r.repo, cell: r.arms[arm] })));

function renderDecision(name: string, d: Decision): string {
  const numbers = Object.entries(d.numbers).map(([k, v]) => `${k} ${v}`).join(", ");
  return `- **${name}: ${d.outcome}${d.note ? ` (${d.note})` : ""}.** ${d.because}${numbers ? ` (${numbers})` : ""}`;
}

/** A measured rate for display: rounded, or n/a when nothing was there to divide by. */
const shown = (n: number | null, digits: number) => (n === null ? "n/a" : round(n, digits));

export function renderArmsReport(report: ArmsReport, template: string): string {
  const maxPages = cellsOf(report).find(({ cell }) => cell.meta?.dry_run)?.cell.meta?.max_pages;
  const noResult = "no result";
  const grounded = report.judged
    ? table(
        ["repo", "arm", "grounded rate", "grounded claims / 1,000 words", "resolution rate", "claimSupportRate (reference)", "judge failures", "claim groups"],
        cellsOf(report).map(({ repo, cell }) => cell.judged
          ? [repo, cell.arm, shown(cell.judged.groundedRate, 3), shown(cell.judged.groundedPer1000Words, 2), shown(cell.judged.resolutionRate, 3), shown(cell.judged.claimSupportRate, 3), cell.judged.judgeFailures, cell.judged.groups]
          : [repo, cell.arm, noResult, "", "", "", "", ""]),
      )
    : "Not judged: run `pnpm bench:arms --judged`.";
  const comparativeRows = report.repos.flatMap((r) => (Object.entries(r.comparative) as Array<[PairKey, Record<ArmDimension, CellVerdict>]>).map(([pair, byDim]) => [
    r.repo, ...pair.split("~"),
    ...ARM_DIMENSIONS.map((d) => (byDim[d].unreliable ? "unreliable" : `${byDim[d].verdict} (${byDim[d].margin >= 0 ? "+" : ""}${byDim[d].margin})`)),
  ]));
  const comparative = comparativeRows.length > 0 ? table(["repo", "A", "B", ...ARM_DIMENSIONS], comparativeRows) : "No pair judged.";
  const usage = table(
    ["repo", "arm", "status", "pages", "total tokens", "input", "cache write", "cache read", "output", "cost USD", "minutes", "cost / page", "minutes / page"],
    cellsOf(report).map(({ repo, cell }) => {
      const u = cell.meta?.usage;
      const unknown = "unknown";
      return [
        repo, cell.arm, cell.status, cell.pageCount, cell.totalTokens ?? unknown, u?.input_tokens ?? unknown, u?.cache_creation_input_tokens ?? unknown,
        u?.cache_read_input_tokens ?? unknown, u?.output_tokens ?? unknown, cell.costUsd ?? unknown, cell.minutes, cell.costPerPage ?? "", cell.minutesPerPage ?? "",
      ];
    }),
  );
  const p = report.projection;
  const projectionText = p
    ? [
        "### The full run, projected from this dry run",
        "",
        `m = ${p.minutesPerPage} minutes per page (the largest among the complete arms), so capMinutes gives ` +
          `${REPOS.map((r) => `${r} ${p.timeCaps[r]}`).join(", ")} minutes: the values for ARM_TIME_CAPS.`,
        "",
        table(["repository", "cloud pages", ...ARMS.map((a) => `${a} USD`), "all three arms USD"], REPOS.map((r) => {
          const costs = ARMS.map((a) => p.costUsd[r][a]);
          return [r, CLOUD_PAGE_COUNTS[r], ...costs.map((c) => c ?? ""), round(sum(costs.map((c) => c ?? 0)), 2)];
        })),
      ].join("\n")
    : "";
  const deterministic = table(
    ["repo", "arm", "pages", "avg words", "avg H2", "thin pages", "citations / 1k words", "valid diagram pages", "invalid diagram pages"],
    cellsOf(report).flatMap(({ repo, cell }) => {
      const d = cell.deterministic;
      return d ? [[repo, cell.arm, d.pages, d.avgWords, d.avgH2Sections, d.thinPages, d.citationDensityPer1k, d.validDiagramPages, d.invalidDiagramPages]] : [];
    }),
  );
  const incompleteRows = cellsOf(report).filter(({ cell }) => cell.status !== "complete").map(({ repo, cell }) => [repo, cell.arm, cell.reason ?? "incomplete"]);
  const firstMeta = cellsOf(report).find(({ cell }) => cell.meta)?.cell.meta;
  const values: Record<string, string> = {
    title: `Local generation arms, ${report.date}${report.dry_run ? " (DRY RUN)" : ""}`,
    dry_run: report.dry_run ? `> DRY RUN: ${maxPages ?? "a few"} pages per arm: tests the harness, decides nothing.` : "",
    run: [
      `Repositories: ${report.repos.map((r) => `\`${ARM_REPOS[r.repo].repo}@${ARM_REPOS[r.repo].sha.slice(0, 12)}\``).join(", ")}.`,
      firstMeta ? `Model \`${firstMeta.model}\`, effort \`${firstMeta.effort}\`.` : "",
      report.judge ? `Judge \`${report.judge}\`, every claim group (full population).` : "Not judged.",
    ].filter(Boolean).join(" "),
    decisions: [renderDecision("Rule 1, the map", report.decisions.rule1), renderDecision("Rule 2, the landing claim", report.decisions.rule2)].join("\n"),
    grounded, comparative, usage, projection: projectionText, deterministic,
    incomplete: incompleteRows.length > 0 ? table(["repo", "arm", "reason"], incompleteRows) : "None.",
  };
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) => values[key] ?? placeholder);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { repos: { type: "string" }, date: { type: "string" }, judged: { type: "boolean", default: false } } });
  const repos = (values.repos ?? "").split(",").filter(Boolean) as RepoName[];
  if (repos.length === 0 || repos.some((r) => !REPOS.includes(r))) throw new Error(`[bench:arms] --repos takes a comma list of ${REPOS.join(", ")}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date ?? "")) throw new Error("[bench:arms] --date YYYY-MM-DD is required");
  const date = values.date ?? "";
  if (values.judged) requireJudgeCredentials();
  const report = await armsReport({ repos, date, judged: values.judged ?? false });
  const jsonPath = join(ROOT, "results", `arms-${date}.json`);
  const mdPath = join(ROOT, "docs", "benchmarks", `${date}-local-generation-arms${report.dry_run ? "-DRY-RUN" : ""}.md`);
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(mdPath, renderArmsReport(report, await readFile(TEMPLATE, "utf-8")));
  console.log(`[bench:arms] wrote ${jsonPath}\n[bench:arms] wrote ${mdPath}`);
  const outcome = (d: Decision) => `${d.outcome}${d.note ? ` (${d.note})` : ""}`;
  console.log(`rule 1: ${outcome(report.decisions.rule1)}; rule 2: ${outcome(report.decisions.rule2)}`);
}

const isEntryPoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
