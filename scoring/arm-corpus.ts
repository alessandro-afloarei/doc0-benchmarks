// Generation arms: corpora/arms/<repo>-<arm>-<date>/, written by runners/arms/run-arm.ts.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { WikiPage } from "./corpus.ts";
import { extractClaimCitations, groupClaimCitations, LINK_STRIP, type ClaimGroup } from "./judge-accuracy.ts";
import { loadOpenwikiClaimGroups } from "./openwiki-claims.ts";

export type ArmName = "openwiki" | "doc0-map" | "doc0-nomap";

export interface ArmMeta {
  schema_version: 3;
  system: "doc0" | "openwiki";
  arm: ArmName;
  repo: string;
  source_repo_sha: string;
  generated_at: string;
  model: string;
  effort: string;
  /** doc0's packed version (and commit when given), or "openwiki@0.9.0". */
  tool_version: string;
  dry_run: boolean;
  max_pages: number | null;
  time_cap_minutes: number;
  budget_usd: number;
  status: "complete" | "incomplete";
  reason: string | null;
  page_count: number;
  /** Usage, cost and turns come from claude's final result: null (unknown, never 0) for a run that ended without one. */
  usage: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number } | null;
  cost_usd: number | null;
  duration_ms: number;
  num_turns: number | null;
}

/** The settings two arms must share to be compared: the report refuses a pair that differs in any. */
export const ARM_SETTINGS = ["model", "effort", "dry_run", "max_pages", "time_cap_minutes", "budget_usd", "source_repo_sha"] as const satisfies ReadonlyArray<keyof ArmMeta>;

/** A corpus folder's _meta.json, refused when an older harness wrote it (it lacks fields the report checks). */
export async function readArmMeta(dir: string): Promise<ArmMeta> {
  const meta = JSON.parse(await readFile(join(dir, "_meta.json"), "utf-8")) as ArmMeta;
  if (meta.schema_version !== 3) throw new Error(`${dir}/_meta.json has schema_version ${String(meta.schema_version)}, not 3: run the arm again.`);
  return meta;
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

/**
 * One arm's corpus folder. doc0's claims come from its pages' citations,
 * grouped per page as judgeAccuracy groups them; openwiki's from its Claims
 * sidecars under _claims/. Either way only prose claims count (proseClaims).
 */
export async function loadArmCorpus(dir: string): Promise<ArmCorpus> {
  const meta = await readArmMeta(dir);
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .filter((f) => !f.startsWith("_claims/"))
    .sort();
  const pages = await Promise.all(files.map(async (f) => splitFrontMatter(f, await readFile(join(dir, f), "utf-8"))));
  const claimGroups = meta.system === "doc0"
    ? pages.flatMap((p) => groupClaimCitations(extractClaimCitations(p.content)))
    : loadOpenwikiClaimGroups(join(dir, "_claims"));
  return { meta, pages, claimGroups: proseClaims(claimGroups, pages) };
}
