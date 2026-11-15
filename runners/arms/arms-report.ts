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
import { loadArmCorpus, type ArmCorpus, type ArmMeta, type ArmName } from "../../scoring/arm-corpus.ts";
import type { WikiPage } from "../../scoring/corpus.ts";
import { judgeClaimGroups, liveAccuracyJudge, parseRef, type AccuracyJudgeFn, type ClaimGroupScore } from "../../scoring/judge-accuracy.ts";
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

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const LINK = /\[([^\]]+?)\]\(([^)]*)\)/g;
const HAS_LINK = /\[[^\]]*\]\([^)]*\)/;

/** A page body without what only cites: front matter, `Sources:` lines holding a link, and citation links (their label stays). */
export function stripCitations(markdown: string): string {
  return markdown
    .replace(FRONT_MATTER, "")
    .split("\n")
    .filter((line) => !(/^\s*Sources:/.test(line) && HAS_LINK.test(line)))
    .join("\n")
    .replace(LINK, (link, label: string, url: string) => (url.startsWith("repo://") || parseRef(label, url) !== null ? label : link));
}

const round = (n: number, digits: number) => Number(n.toFixed(digits));

/** Supported groups per 1,000 words of the arm's page bodies, citations stripped: fewer claims cannot raise it. */
export function groundedPer1000Words(score: Pick<ClaimGroupScore, "supported">, pages: WikiPage[]): number {
  const words = pages.reduce((sum, p) => sum + wordCount(stripCitations(p.content)), 0);
  return words === 0 ? 0 : round((score.supported * 1000) / words, 2);
}

// ---------------------------------------------------------------------------
// Decision rules (the template states them; these apply them)
// ---------------------------------------------------------------------------

export interface RuleInput {
  repo: string;
  /** Only arms that completed and were judged. */
  arms: Partial<Record<ArmName, { grounded: number; per1000: number; tokens: number }>>;
  comparative: Partial<Record<PairKey, Partial<Record<ArmDimension, CellVerdict["verdict"] | "unreliable">>>>;
}

export interface Decision {
  outcome: "keep" | "remove" | "allowed" | "refused" | "undecided";
  because: string;
  numbers: Record<string, number | string>;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** A difference of rates in percentage points, to one decimal: 0.82 − 0.80 is 2.0, not 1.9999. */
const points = (a: number, b: number) => Math.round((a - b) * 1000) / 10;

function withArms<A extends ArmName>(repos: RuleInput[], arms: readonly A[]) {
  return repos.flatMap((r) => {
    const cells = arms.map((a) => r.arms[a]);
    return cells.every((c) => c !== undefined) ? [{ ...r, cells: Object.fromEntries(arms.map((a, i) => [a, cells[i]])) as Record<A, { grounded: number; per1000: number; tokens: number }> }] : [];
  });
}

const undecided = (because: string): Decision => ({ outcome: "undecided", because, numbers: {} });

/** Rule 1: the map stays in doc0_begin. */
export function decideRule1(repos: RuleInput[]): Decision {
  const both = withArms(repos, ["doc0-map", "doc0-nomap"] as const);
  if (repos.length === 0 || both.length < repos.length) {
    return undecided(`doc0-map or doc0-nomap has no judged result on ${repos.filter((r) => !both.some((b) => b.repo === r.repo)).map((r) => r.repo).join(", ") || "any repository"}.`);
  }
  const groundedDiffPoints = points(mean(both.map((b) => b.cells["doc0-map"].grounded)), mean(both.map((b) => b.cells["doc0-nomap"].grounded)));
  const comparativeWins = both.filter((b) => b.comparative["doc0-map~doc0-nomap"]?.depth === "better" && b.comparative["doc0-map~doc0-nomap"]?.breadth === "better").length;
  const comparativeWinsNeeded = Math.ceil((2 * both.length) / 3);
  const mapTokens = sum(both.map((b) => b.cells["doc0-map"].tokens));
  const nomapTokens = sum(both.map((b) => b.cells["doc0-nomap"].tokens));
  const tokensWithin = 4 * mapTokens <= 5 * nomapTokens; // at most 25% more, in integers
  const better = groundedDiffPoints >= 2 || comparativeWins >= comparativeWinsNeeded;
  const numbers = { groundedDiffPoints, comparativeWins, comparativeWinsNeeded, tokenRatio: nomapTokens === 0 ? "n/a" : round(mapTokens / nomapTokens, 3) };
  const keep = better && tokensWithin;
  return {
    outcome: keep ? "keep" : "remove",
    because:
      `doc0-map ${groundedDiffPoints >= 0 ? "+" : ""}${groundedDiffPoints} points of mean grounded rate (needs +2.0), ` +
      `depth-and-breadth wins in ${comparativeWins} of ${both.length} repositories (needs ${comparativeWinsNeeded}), ` +
      `${numbers.tokenRatio}× doc0-nomap's tokens (at most 1.25).`,
    numbers,
  };
}

/** Rule 2: the landing page may say doc0's generation beats openwiki. */
export function decideRule2(repos: RuleInput[]): Decision {
  const all = withArms(repos, ["openwiki", "doc0-map", "doc0-nomap"] as const);
  if (repos.length === 0 || all.length < repos.length) {
    return undecided(`an arm has no judged result on ${repos.filter((r) => !all.some((a) => a.repo === r.repo)).map((r) => r.repo).join(", ") || "any repository"}.`);
  }
  const betterArm = mean(all.map((a) => a.cells["doc0-map"].grounded)) >= mean(all.map((a) => a.cells["doc0-nomap"].grounded)) ? "doc0-map" : "doc0-nomap";
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
  totalTokens: number;
  costUsd: number;
  minutes: number;
  costPerPage: number | null;
  minutesPerPage: number | null;
  deterministic?: StructuralMetrics;
  judged?: ClaimGroupScore & { groundedPer1000Words: number };
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
  const u = meta?.usage;
  const pageCount = meta?.page_count ?? 0;
  const costUsd = meta?.cost_usd ?? 0;
  const minutes = (meta?.duration_ms ?? 0) / 60_000;
  return {
    arm, status: meta?.status ?? "incomplete", reason, meta, pageCount,
    totalTokens: u ? u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens + u.output_tokens : 0,
    costUsd, minutes: round(minutes, 1),
    costPerPage: pageCount === 0 ? null : round(costUsd / pageCount, 2),
    minutesPerPage: pageCount === 0 ? null : round(minutes / pageCount, 2),
  };
}

const exists = (path: string) => stat(path).then(() => true, () => false);
const stripped = (pages: WikiPage[]) => pages.map((p) => ({ ...p, content: stripCitations(p.content) }));

function ruleInput(r: RepoArmsReport): RuleInput {
  const arms: RuleInput["arms"] = {};
  for (const cell of Object.values(r.arms)) {
    if (cell.judged) arms[cell.arm] = { grounded: cell.judged.groundedRate, per1000: cell.judged.groundedPer1000Words, tokens: cell.totalTokens };
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
    const own = cells.filter((c) => c.arm === arm).map((c) => c.costUsd / c.pageCount);
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
  for (const repo of o.repos) {
    const arms = {} as Record<ArmName, ArmCell>;
    const complete = new Map<ArmName, ArmCorpus>();
    for (const arm of ARMS) {
      const name = `${repo}-${arm}-${o.date}`;
      if (!(await exists(join(corporaDir, name, "_meta.json")))) {
        arms[arm] = usageCell(arm, null, `no corpus at ${name}`);
        continue;
      }
      const corpus = await loadArmCorpus(join(corporaDir, name));
      arms[arm] = usageCell(arm, corpus.meta, corpus.meta.reason);
      if (corpus.meta.status !== "complete") continue;
      complete.set(arm, corpus);
      arms[arm].deterministic = await computeStructuralMetrics(corpus.pages);
    }
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
  const metas = repos.flatMap((r) => Object.values(r.arms)).flatMap((c) => (c.meta ? [c.meta] : []));
  const dryRun = metas.some((m) => m.dry_run);
  const inputs = repos.map(ruleInput);
  const model = o.judged ? (deps.judgeName ?? judgeModel()) : null;
  return {
    schema_version: 1, date: o.date, dry_run: dryRun, judged: o.judged,
    judge: model === null ? null : typeof model === "string" ? model : model.modelId,
    repos,
    decisions: { rule1: decideRule1(inputs), rule2: decideRule2(inputs) },
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
  return `- **${name}: ${d.outcome}.** ${d.because}${numbers ? ` (${numbers})` : ""}`;
}

export function renderArmsReport(report: ArmsReport, template: string): string {
  const maxPages = cellsOf(report).find(({ cell }) => cell.meta?.dry_run)?.cell.meta?.max_pages;
  const noResult = "no result";
  const grounded = report.judged
    ? table(
        ["repo", "arm", "grounded rate", "grounded claims / 1,000 words", "resolution rate", "claimSupportRate (reference)", "judge failures", "claim groups"],
        cellsOf(report).map(({ repo, cell }) => cell.judged
          ? [repo, cell.arm, cell.judged.groundedRate, cell.judged.groundedPer1000Words, cell.judged.resolutionRate, cell.judged.claimSupportRate, cell.judged.judgeFailures, cell.judged.groups]
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
      return [repo, cell.arm, cell.status, cell.pageCount, cell.totalTokens, u?.input_tokens ?? 0, u?.cache_creation_input_tokens ?? 0, u?.cache_read_input_tokens ?? 0, u?.output_tokens ?? 0, cell.costUsd, cell.minutes, cell.costPerPage ?? "", cell.minutesPerPage ?? ""];
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
  console.log(`rule 1: ${report.decisions.rule1.outcome}; rule 2: ${report.decisions.rule2.outcome}`);
}

const isEntryPoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
