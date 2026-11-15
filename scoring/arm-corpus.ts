// Generation arms: corpora/arms/<repo>-<arm>-<date>/, written by runners/arms/run-arm.ts.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { WikiPage } from "./corpus.ts";
import { extractClaimCitations, groupClaimCitations, type ClaimGroup } from "./judge-accuracy.ts";
import { loadOpenwikiClaimGroups } from "./openwiki-claims.ts";

export type ArmName = "openwiki" | "doc0-map" | "doc0-nomap";

export interface ArmMeta {
  schema_version: 2;
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
  status: "complete" | "incomplete";
  reason: string | null;
  page_count: number;
  usage: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number };
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
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

/**
 * One arm's corpus folder. doc0's claims come from its pages' citations,
 * grouped per page as judgeAccuracy groups them; openwiki's from its Claims
 * sidecars under _claims/.
 */
export async function loadArmCorpus(dir: string): Promise<ArmCorpus> {
  const meta = JSON.parse(await readFile(join(dir, "_meta.json"), "utf-8")) as ArmMeta;
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
  return { meta, pages, claimGroups };
}
