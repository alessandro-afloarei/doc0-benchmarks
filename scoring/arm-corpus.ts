// Generation arms: corpora/arms/<repo>-<arm>-<date>/, written by runners/arms/run-arm.ts.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { WikiPage } from "./corpus.ts";
import { extractClaimCitations, groupClaimCitations, LINK_STRIP, type ClaimGroup } from "./judge-accuracy.ts";
import { loadOpenwikiClaimGroups } from "./openwiki-claims.ts";

export type ArmName = "openwiki" | "doc0-map" | "doc0-nomap";

/** How the run signed in, never the value: an API key (ANTHROPIC_API_KEY), or a subscription (claude's CLAUDE_CODE_OAUTH_TOKEN, codex's ChatGPT login). */
export type ArmCredential = "api-key" | "subscription";

/** The agent that ran the arm: Claude Code (`claude -p`) or the Codex CLI (`codex exec`). */
export type ArmHost = "claude" | "codex";

export interface ArmMeta {
  schema_version: 4;
  system: "doc0" | "openwiki";
  arm: ArmName;
  repo: string;
  source_repo_sha: string;
  generated_at: string;
  host: ArmHost;
  model: string;
  effort: string;
  /** doc0's packed version (and commit when given), or "openwiki@0.9.0". */
  tool_version: string;
  dry_run: boolean;
  max_pages: number | null;
  time_cap_minutes: number;
  /** claude's --max-budget-usd; null on codex, which has no spend cap (its time cap still holds). */
  budget_usd: number | null;
  credential: ArmCredential;
  status: "complete" | "incomplete";
  reason: string | null;
  page_count: number;
  /** Usage, cost and turns come from claude's final result (codex: its turn.completed usage and completed items): null (unknown, never 0) for a run that ended without one. */
  usage: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number } | null;
  /** claude's total_cost_usd: on a subscription, Claude Code's API-equivalent figure, not money charged. Always null on codex, which reports none. */
  cost_usd: number | null;
  duration_ms: number;
  num_turns: number | null;
}

/** The settings two arms must share to be compared: the report refuses a pair that differs in any. */
export const ARM_SETTINGS = ["host", "model", "effort", "credential", "dry_run", "max_pages", "time_cap_minutes", "budget_usd", "source_repo_sha"] as const satisfies ReadonlyArray<keyof ArmMeta>;

/** A corpus folder's _meta.json, refused when an older harness wrote it (it lacks fields the report checks). */
export async function readArmMeta(dir: string): Promise<ArmMeta> {
  const meta = JSON.parse(await readFile(join(dir, "_meta.json"), "utf-8")) as Omit<ArmMeta, "host"> & { host?: ArmHost };
  if (meta.schema_version !== 4) throw new Error(`${dir}/_meta.json has schema_version ${String(meta.schema_version)}, not 4: run the arm again.`);
  // Every run before the codex host was a claude run, and its meta names no host.
  return { ...meta, host: meta.host ?? "claude" };
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/** A page file's front matter `title:` (doc0 writes a JSON string, openwiki YAML), and the body without it. */
function splitFrontMatter(slug: string, raw: string): WikiPage {
  const match = FRONT_MATTER.exec(raw);
  const titleLine = match?.[1].split(/\r?\n/).find((l) => l.startsWith("title:"));
  const title = titleLine?.slice("title:".length).trim().replace(/^(["'])(.*)\1$/, "$2") ?? slug;
  return { slug, title, content: raw.slice(match?.[0].length ?? 0).trim(), verifiedClaimRatio: null };
}

export interface ArmCorpus { meta: ArmMeta; pages: WikiPage[]; claimGroups: ClaimGroup[] }

/** Every line of a fenced block (its fences and a diagram's edges included), as the extractor would read it as a claim. */
function fencedLines(content: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const opening = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence === null && opening === null) continue;
    out.push(trimmed.replace(LINK_STRIP, "").trim().slice(0, 500));
    if (fence === null) fence = opening?.[1] ?? null;
    else if (trimmed.startsWith(fence) && /^[`~]+$/.test(trimmed)) fence = null;
  }
  return out.filter((l) => l !== "");
}

const TABLE_ROW = /^\|.*\|$/;
const DIAGRAM_EDGE = /\s(-->|-\.->|==>)/;

/**
 * A claim group is a claim only when its text is prose: never a line of a
 * fenced block (code, a diagram) on one of the arm's pages, a table row or a
 * diagram edge. doc0's skill puts a Sources line after every code block,
 * diagram and table, and the extractor then reads the block's last long line
 * as the claim. Arms only: the published extractor is unchanged.
 */
function proseClaims(groups: ClaimGroup[], pages: WikiPage[]): ClaimGroup[] {
  const code = new Set(pages.flatMap((p) => fencedLines(p.content)));
  return groups.filter(({ claim }) => !code.has(claim.trim()) && !TABLE_ROW.test(claim.trim()) && !DIAGRAM_EDGE.test(claim));
}

/** A page file and the section its wiki's navigation puts it in (none for a root page). */
interface NavEntry { file: string; section?: string }

/** A file's text, or null when it is not there (a corpus made before the harness kept navigation). */
const readIfThere = (path: string) =>
  readFile(path, "utf-8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });

/** doc0's navigation.json (kept beside the pages): its sections in order, each with its pages, then the root pages. */
async function doc0Navigation(dir: string): Promise<NavEntry[]> {
  const text = await readIfThere(join(dir, "navigation.json"));
  if (text === null) return [];
  const nav = JSON.parse(text) as { sections: Array<{ title: string; pages: string[] }>; pages: string[] };
  return [
    ...nav.sections.flatMap((s) => s.pages.map((slug) => ({ file: `${slug}.md`, section: s.title }))),
    ...nav.pages.map((slug) => ({ file: `${slug}.md` })),
  ];
}

const INDEX_LINK = /^- \[([^\]]+)\]\(([^)]+)\)/;

/** openwiki's index.md files (kept beside the pages): each folder's links in the order its index lists them, a folder's own index read in its place. */
async function openwikiNavigation(dir: string, folder = "", section?: string): Promise<NavEntry[]> {
  const text = await readIfThere(join(dir, folder, "index.md"));
  if (text === null) return [];
  const entries: NavEntry[] = [];
  for (const line of text.split("\n")) {
    const [, label, target] = INDEX_LINK.exec(line) ?? [];
    if (label === undefined || target === undefined) continue;
    const path = join(folder, target);
    if (target.endsWith("/")) entries.push(...(await openwikiNavigation(dir, path, section === undefined ? label : `${section} / ${label}`)));
    else if (target.endsWith(".md")) entries.push({ file: path, ...(section === undefined ? {} : { section }) });
  }
  return entries;
}

/** The files in the wiki's own navigation order with their sections, then the files it does not list, by path. */
function inNavigationOrder(files: string[], nav: NavEntry[]): NavEntry[] {
  const unlisted = new Set(files);
  const listed = nav.filter((e) => unlisted.delete(e.file));
  return [...listed, ...[...unlisted].map((file) => ({ file }))];
}

/**
 * One arm's corpus folder, its pages in the wiki's own navigation order (the
 * judge samples the first pages, so path order would show it an arbitrary
 * slice). doc0's claims come from its pages' citations, grouped per page as
 * judgeAccuracy groups them; openwiki's from its Claims sidecars under
 * _claims/. Either way only prose claims count (proseClaims).
 */
export async function loadArmCorpus(dir: string): Promise<ArmCorpus> {
  const meta = await readArmMeta(dir);
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && !(meta.system === "openwiki" && e.name === "index.md"))
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .filter((f) => !f.startsWith("_claims/"))
    .sort();
  const nav = meta.system === "doc0" ? await doc0Navigation(dir) : await openwikiNavigation(dir);
  const pages = await Promise.all(inNavigationOrder(files, nav).map(async ({ file, section }) => ({
    ...splitFrontMatter(file, await readFile(join(dir, file), "utf-8")),
    ...(section === undefined ? {} : { section }),
  })));
  const claimGroups = meta.system === "doc0"
    ? pages.flatMap((p) => groupClaimCitations(extractClaimCitations(p.content)))
    : loadOpenwikiClaimGroups(join(dir, "_claims"));
  return { meta, pages, claimGroups: proseClaims(claimGroups, pages) };
}
