// Runs one generation arm on one repository: a fresh clone at the corpus SHA,
// the arm installed into it, Claude Code headless in an empty config folder,
// then the pages kept as corpora/arms/<repo>-<arm>-<date>/ with _meta.json.
//
// Usage:
//   pnpm bench:arm --repo fd --arm doc0-map --date 2026-11-16 [--max-pages 3] [--budget 15]
//                  [--timeout-minutes N] [--model claude-opus-5-5] [--effort high]
// Environment: ANTHROPIC_API_KEY, DOC0_CLI and DOC0_SKILL (doc0 arms), OPENWIKI_BIN (openwiki),
// BENCH_WORK_DIR (default /work/artifacts/doc0-arms-<today>), DOC0_COMMIT (optional, recorded).

import { spawn } from "node:child_process";
import { constants, type Dirent } from "node:fs";
import { access, cp, mkdir, open, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { ensureSourceAt } from "../grounding-scorecard.ts";
import type { ArmMeta, ArmName } from "../../scoring/arm-corpus.ts";
import {
  ARM_REPOS, ARM_TIME_CAPS, ARMS, armDirs, armPrompt, armSetup, armSystem, claudeArgs, DRY_RUN_TIME_CAP,
  isolationProblem, REPOS, usableDoc0Cli, type ArmTools, type RepoName,
} from "./arms.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CORPORA_ARMS_DIR = join(ROOT, "corpora", "arms");

export interface RunArmOptions {
  repo: RepoName;
  arm: ArmName;
  date: string;
  model: string;
  effort: string;
  budgetUsd: number;
  timeoutMinutes: number;
  maxPages?: number;
  workDir: string;
  tools: ArmTools;
  toolVersion: string;
}

export interface RunArmDeps {
  cloneAt?: (repo: string, sha: string, dir: string) => Promise<string>;
  claudeBin?: string;
  corporaDir?: string;
}

interface ClaudeResult {
  type: "result";
  subtype: string;
  errors?: string[];
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: Partial<ArmMeta["usage"]>;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/** Runs claude as its own process group, so a time cap stops it and every server it started. */
async function runClaude(
  bin: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; transcriptFile: string; stderrFile: string },
): Promise<{ timedOut: boolean; code: number | null }> {
  const [out, err] = await Promise.all([open(o.transcriptFile, "w"), open(o.stderrFile, "w")]);
  try {
    const child = spawn(bin, args, { cwd: o.cwd, env: o.env, detached: true, stdio: ["ignore", out.fd, err.fd] });
    const killGroup = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        // ESRCH: the group is already gone.
      }
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, o.timeoutMs);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    }).finally(() => clearTimeout(timer));
    killGroup();
    return { timedOut, code };
  } finally {
    await Promise.all([out.close(), err.close()]);
  }
}

function parseTranscript(text: string): unknown[] {
  return text.split("\n").flatMap((line) => {
    try {
      return line.trim() === "" ? [] : [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
}

const isResult = (e: unknown): e is ClaudeResult => typeof e === "object" && e !== null && "type" in e && e.type === "result";

async function mdFiles(dir: string): Promise<string[]> {
  const entries: Dirent[] = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .filter((rel) => !rel.split("/").some((part) => part.startsWith(".")))
    .sort();
}

/** Copies the arm's pages into the corpus folder: doc0's page files, or openwiki's pages without generated index.md plus its Claims. */
async function keepPages(arm: ArmName, clone: string, corpus: string): Promise<number> {
  const [from, pages] = armSystem(arm) === "doc0"
    ? [join(clone, ".doc0", "pages"), (await mdFiles(join(clone, ".doc0", "pages"))).filter((f) => !f.includes("/") && !f.endsWith(".remote.md"))]
    : [join(clone, "openwiki"), (await mdFiles(join(clone, "openwiki"))).filter((f) => f.split("/").pop() !== "index.md")];
  for (const page of pages) await cp(join(from, page), join(corpus, page));
  if (armSystem(arm) === "openwiki" && (await exists(join(from, ".claims")))) {
    await cp(join(from, ".claims"), join(corpus, "_claims"), { recursive: true });
  }
  return pages.length;
}

/** The run-state file an arm's finish step deletes: while it exists, the run did not finish. */
const RUN_STATE: Record<"doc0" | "openwiki", string> = { doc0: ".doc0/run.json", openwiki: "openwiki/.run.json" };

export async function runArm(o: RunArmOptions, deps: RunArmDeps = {}): Promise<ArmMeta> {
  const { cloneAt = ensureSourceAt, claudeBin = "claude", corporaDir = CORPORA_ARMS_DIR } = deps;
  const dirs = armDirs(o.workDir, o.repo, o.arm);
  if (await exists(dirs.root)) throw new Error(`${dirs.root} already exists: move it away (it may hold a paid run's transcript), then run again.`);
  const { repo, sha } = ARM_REPOS[o.repo];
  await cloneAt(repo, sha, dirs.clone);
  await mkdir(dirs.config, { recursive: true });
  const { mcpConfigFile } = await armSetup(o.arm, dirs.clone, o.tools);

  const started = Date.now();
  const transcriptFile = join(dirs.root, "transcript.jsonl");
  const { timedOut, code } = await runClaude(
    claudeBin,
    claudeArgs({ prompt: armPrompt(o.arm, { maxPages: o.maxPages }), mcpConfigFile, model: o.model, effort: o.effort, budgetUsd: o.budgetUsd }),
    { cwd: dirs.clone, env: { ...process.env, CLAUDE_CONFIG_DIR: dirs.config }, timeoutMs: o.timeoutMinutes * 60_000, transcriptFile, stderrFile: join(dirs.root, "stderr.log") },
  );
  const events = parseTranscript(await readFile(transcriptFile, "utf-8"));
  const result = events.findLast(isResult);
  if (result) await writeFile(join(dirs.root, "result.json"), `${JSON.stringify(result, null, 2)}\n`);

  const corpus = join(corporaDir, `${o.repo}-${o.arm}-${o.date}`);
  await rm(corpus, { recursive: true, force: true });
  await mkdir(corpus, { recursive: true });
  const pageCount = await keepPages(o.arm, dirs.clone, corpus);

  const system = armSystem(o.arm);
  const isolation = isolationProblem(o.arm, events);
  let reason: string | null = null;
  if (timedOut) reason = `time cap ${o.timeoutMinutes} min`;
  else if (!result) reason = `claude exited ${String(code)} without a result`;
  else if (result.subtype !== "success") reason = [result.subtype, ...(result.errors ?? [])].join(": ");
  else if (isolation) reason = `isolation: ${isolation}`;
  else if (await exists(join(dirs.clone, RUN_STATE[system]))) reason = `finish not reached: ${RUN_STATE[system]} is still there`;
  else if (pageCount === 0) reason = "finish not reached: no pages";

  const meta: ArmMeta = {
    schema_version: 2, system, arm: o.arm, repo, source_repo_sha: sha, generated_at: new Date().toISOString(),
    model: o.model, effort: o.effort, tool_version: o.toolVersion,
    dry_run: o.maxPages !== undefined, max_pages: o.maxPages ?? null, time_cap_minutes: o.timeoutMinutes,
    status: reason === null ? "complete" : "incomplete", reason, page_count: pageCount,
    usage: {
      input_tokens: result?.usage?.input_tokens ?? 0,
      cache_creation_input_tokens: result?.usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: result?.usage?.cache_read_input_tokens ?? 0,
      output_tokens: result?.usage?.output_tokens ?? 0,
    },
    cost_usd: result?.total_cost_usd ?? 0,
    duration_ms: result?.duration_ms ?? Date.now() - started,
    num_turns: result?.num_turns ?? 0,
  };
  await writeFile(join(corpus, "_meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** `<name>@<version>` of the package holding a binary: the nearest package.json above its real path. */
async function packageVersion(bin: string): Promise<string> {
  for (let dir = dirname(await realpath(bin)); dir !== dirname(dir); dir = dirname(dir)) {
    const pkg = (await readFile(join(dir, "package.json"), "utf-8").then(JSON.parse, () => null)) as { name?: string; version?: string } | null;
    if (pkg?.name && pkg.version) return `${pkg.name}@${pkg.version}`;
  }
  throw new Error(`no package.json above ${bin}`);
}

async function executable(path: string | undefined): Promise<boolean> {
  return path !== undefined && access(path, constants.X_OK).then(() => true, () => false);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" }, arm: { type: "string" }, date: { type: "string" },
      "max-pages": { type: "string" }, budget: { type: "string", default: "15" }, "timeout-minutes": { type: "string" },
      model: { type: "string", default: "claude-opus-5-5" }, effort: { type: "string", default: "high" },
    },
  });
  const repo = values.repo as RepoName;
  const arm = values.arm as ArmName;
  const fail = (message: string): never => {
    throw new Error(`[bench:arm] ${message}`);
  };
  if (!REPOS.includes(repo)) fail(`--repo must be one of ${REPOS.join(", ")}`);
  if (!(ARMS as readonly string[]).includes(arm)) fail(`--arm must be one of ${ARMS.join(", ")}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date ?? "")) fail("--date YYYY-MM-DD is required");
  if (!process.env.ANTHROPIC_API_KEY) fail("ANTHROPIC_API_KEY is not set: each run's config folder starts empty, with no login.");
  const maxPages = values["max-pages"] === undefined ? undefined : Number(values["max-pages"]);
  const env = process.env;
  const tools: ArmTools = { doc0Cli: env.DOC0_CLI ?? "", doc0Skill: env.DOC0_SKILL ?? "", openwikiBin: env.OPENWIKI_BIN ?? "" };
  let toolVersion: string;
  if (armSystem(arm) === "doc0") {
    const problem = await usableDoc0Cli(env.DOC0_CLI);
    if (problem) fail(problem);
    if (!(await exists(tools.doc0Skill))) fail("DOC0_SKILL is not a file: the installed package's skill/doc0-write/SKILL.md.");
    toolVersion = `${await packageVersion(tools.doc0Cli)}${env.DOC0_COMMIT ? `+${env.DOC0_COMMIT}` : ""}`;
  } else {
    if (!(await executable(env.OPENWIKI_BIN))) fail("OPENWIKI_BIN is not an executable file: the openwiki binary under $BENCH_WORK_DIR/tools.");
    toolVersion = await packageVersion(tools.openwikiBin);
  }
  const meta = await runArm({
    repo, arm, date: values.date ?? "", model: values.model ?? "", effort: values.effort ?? "",
    budgetUsd: Number(values.budget), maxPages,
    timeoutMinutes: values["timeout-minutes"] ? Number(values["timeout-minutes"]) : maxPages === undefined ? ARM_TIME_CAPS[repo] : DRY_RUN_TIME_CAP,
    workDir: env.BENCH_WORK_DIR ?? `/work/artifacts/doc0-arms-${new Date().toISOString().slice(0, 10)}`,
    tools, toolVersion,
  });
  console.log(JSON.stringify(meta, null, 2));
  if (meta.status !== "complete") process.exitCode = 1;
}

const isEntryPoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
