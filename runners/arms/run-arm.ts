// Runs one generation arm on one repository: a fresh clone at the corpus SHA,
// the arm installed into it, Claude Code headless in an empty config folder,
// then the pages kept as corpora/arms/<repo>-<arm>-<date>/ with _meta.json.
//
// Usage:
//   pnpm bench:arm --repo fd --arm doc0-map --date 2026-11-16[-<tag>] [--max-pages 3] [--budget 15]
//                  [--timeout-minutes N] [--model claude-opus-5-5] [--effort high]
// Environment: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (exactly one), DOC0_CLI and DOC0_SKILL (doc0 arms), OPENWIKI_BIN (openwiki),
// BENCH_WORK_DIR (default /work/artifacts/doc0-arms-<today>), DOC0_COMMIT (optional, recorded).

import { spawn } from "node:child_process";
import { constants, createWriteStream, type Dirent } from "node:fs";
import { access, cp, mkdir, open, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { ensureSourceAt } from "../grounding-scorecard.ts";
import type { ArmCredential, ArmMeta, ArmName } from "../../scoring/arm-corpus.ts";
import {
  ARM_REPOS, ARM_TIME_CAPS, ARMS, armCredential, armDirs, armEnv, armFinishTool, armPrompt, armSetup, armSystem, claudeArgs, DRY_RUN_TIME_CAP,
  isolationProblem, redactSecrets, REPOS, secretValues, usableDoc0Cli, type ArmTools, type RepoName,
} from "./arms.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CORPORA_ARMS_DIR = join(ROOT, "corpora", "arms");
/** Each run's transcript and result, beside the judge's raw verdicts (gitignored). */
const RESULTS_ARMS_DIR = join(ROOT, "results", "arms");

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
  credential: ArmCredential;
  tools: ArmTools;
  toolVersion: string;
}

export interface RunArmDeps {
  cloneAt?: (repo: string, sha: string, dir: string) => Promise<string>;
  claudeBin?: string;
  corporaDir?: string;
  resultsDir?: string;
}

interface ClaudeResult {
  type: "result";
  subtype: string;
  errors?: string[];
  num_turns?: number;
  total_cost_usd?: number;
  usage?: Partial<NonNullable<ArmMeta["usage"]>>;
  modelUsage?: Record<string, { inputTokens?: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number; outputTokens?: number }>;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

function parseLine(line: string): unknown {
  try {
    return line.trim() === "" ? undefined : (JSON.parse(line) as unknown);
  } catch {
    return undefined;
  }
}

/**
 * Runs claude as its own process group and copies its stream-json stdout
 * into the transcript line by line. `watch` sees each event as it arrives
 * and may stop the run (a wrong setup in the init event); the time cap stops
 * it too. Stopping, and claude's own exit, kill the whole group, so no tool
 * or server it started outlives it.
 */
async function runClaude(
  bin: string,
  args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMinutes: number; transcriptFile: string; stderrFile: string; watch: (event: unknown) => string | null },
): Promise<{ stopped: string | null; code: number | null }> {
  const err = await open(o.stderrFile, "w");
  const transcript = createWriteStream(o.transcriptFile);
  try {
    const child = spawn(bin, args, { cwd: o.cwd, env: o.env, detached: true, stdio: ["ignore", "pipe", err.fd] });
    const killGroup = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        // ESRCH: the group is already gone.
      }
    };
    let stopped: string | null = null;
    const stop = (why: string) => {
      stopped ??= why;
      killGroup();
    };
    const timer = setTimeout(() => stop(`time cap ${o.timeoutMinutes} min`), o.timeoutMinutes * 60_000);
    if (child.stdout === null) throw new Error("claude's stdout is not a pipe");
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      transcript.write(`${line}\n`);
      const problem = o.watch(parseLine(line));
      if (problem !== null) stop(problem);
    });
    // A child left in the group would hold stdout open: claude's exit reaps it.
    child.on("exit", killGroup);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    }).finally(() => clearTimeout(timer));
    return { stopped, code };
  } finally {
    await new Promise((resolve) => transcript.end(resolve));
    await err.close();
  }
}

const isResult = (e: unknown): e is ClaudeResult => typeof e === "object" && e !== null && "type" in e && e.type === "result";
const isInit = (e: unknown) => typeof e === "object" && e !== null && "type" in e && e.type === "system" && "subtype" in e && e.subtype === "init";

interface ContentBlock { type?: string; id?: string; name?: string; tool_use_id?: string; is_error?: boolean; content?: string | Array<{ type?: string; text?: string }> }
const blocks = (e: unknown): ContentBlock[] => {
  const content = (e as { message?: { content?: unknown } } | undefined)?.message?.content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
};

/**
 * A run's tokens and turns. With background subagents claude prints one result each time its main loop goes idle:
 * each result's `usage` and `num_turns` cover only its own stretch, while `modelUsage` (like `total_cost_usd`)
 * is the whole session's, subagents included. So tokens come from the last result's `modelUsage` and turns are summed.
 */
export function runUsage(events: unknown[]): Pick<ArmMeta, "usage" | "num_turns"> {
  const results = events.filter(isResult);
  const last = results.at(-1);
  if (!last) return { usage: null, num_turns: null };
  const models = Object.values(last.modelUsage ?? {});
  const sum = (key: "inputTokens" | "cacheCreationInputTokens" | "cacheReadInputTokens" | "outputTokens") => models.reduce((n, m) => n + (m[key] ?? 0), 0);
  const usage = models.length > 0
    ? { input_tokens: sum("inputTokens"), cache_creation_input_tokens: sum("cacheCreationInputTokens"), cache_read_input_tokens: sum("cacheReadInputTokens"), output_tokens: sum("outputTokens") }
    : {
        input_tokens: last.usage?.input_tokens ?? 0,
        cache_creation_input_tokens: last.usage?.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: last.usage?.cache_read_input_tokens ?? 0,
        output_tokens: last.usage?.output_tokens ?? 0,
      };
  return { usage, num_turns: results.reduce((n, r) => n + (r.num_turns ?? 0), 0) };
}

/** The last result the arm's finish tool returned in the transcript, parsed from its JSON text; null when it never returned one. */
export function finishResult(arm: ArmName, events: unknown[]): Record<string, unknown> | null {
  const calls = new Set(events.flatMap(blocks).filter((b) => b.type === "tool_use" && b.name === armFinishTool(arm)).map((b) => b.id));
  const results = events.flatMap(blocks).filter((b) => b.type === "tool_result" && calls.has(b.tool_use_id) && b.is_error !== true);
  const last = results.at(-1)?.content;
  const text = typeof last === "string" ? last : last?.find((c) => c.type === "text")?.text;
  const parsed = text === undefined ? undefined : parseLine(text);
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
}

/**
 * The pages a finished run proves, relative to where they sit in the clone,
 * or why the run proves none. doc0: exactly the pages doc0_finish
 * (--no-publish) listed as checked. openwiki: its finish reports no list, and
 * finalizes every page under openwiki/, so every page there but the
 * generated index.md files.
 */
async function provenPages(arm: ArmName, clone: string, events: unknown[]): Promise<{ from: string; pages: string[] } | { problem: string }> {
  const finish = finishResult(arm, events);
  if (armSystem(arm) === "doc0") {
    const from = join(clone, ".doc0", "pages");
    if (finish?.status !== "complete" || finish.published !== false || !Array.isArray(finish.pages)) {
      return { problem: "finish not proven: no doc0_finish result with status complete" };
    }
    const pages = (finish.pages as unknown[]).map((p) => relative(from, String(p)));
    const outside = pages.filter((p) => p.startsWith("..") || !p.endsWith(".md"));
    if (outside.length > 0) return { problem: `doc0_finish listed pages outside .doc0/pages: ${outside.join(", ")}` };
    return { from, pages: pages.sort() };
  }
  if (finish?.status !== "complete") return { problem: "finish not proven: no openwiki_finish result with status complete" };
  if (finish.sourceChanged === true) return { problem: "finish not proven: openwiki_finish reported sourceChanged" };
  const from = join(clone, "openwiki");
  if (!(await exists(join(from, ".claims")))) return { problem: "no Claims: openwiki/.claims is missing" };
  const entries: Dirent[] = await readdir(from, { withFileTypes: true, recursive: true });
  const pages = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "index.md")
    .map((e) => relative(from, join(e.parentPath, e.name)))
    .filter((rel) => !rel.split("/").some((part) => part.startsWith(".")));
  return { from, pages: pages.sort() };
}

/** Every file keepPages would copy, relative to `from`: the proven pages, and openwiki's Claims files. */
async function corpusFiles(arm: ArmName, proven: { from: string; pages: string[] }): Promise<string[]> {
  if (armSystem(arm) === "doc0") return proven.pages;
  const claims = await readdir(join(proven.from, ".claims"), { recursive: true, withFileTypes: true });
  return [...proven.pages, ...claims.filter((e) => e.isFile()).map((e) => relative(proven.from, join(e.parentPath, e.name))).sort()];
}

/** The first file bound for the corpus (which is committed) that holds a secret of the launching environment, by name; null when none does. */
async function corpusLeak(arm: ArmName, proven: { from: string; pages: string[] }): Promise<string | null> {
  const secrets = secretValues(process.env);
  for (const file of await corpusFiles(arm, proven)) {
    const { found } = redactSecrets(await readFile(join(proven.from, file), "utf-8"), secrets);
    if (found.length > 0) return `secret in ${file}: ${found.join(", ")}`;
  }
  return null;
}

/** Copies the proven pages into the corpus folder, and openwiki's Claims as _claims. */
async function keepPages(arm: ArmName, proven: { from: string; pages: string[] }, corpus: string): Promise<void> {
  for (const page of proven.pages) await cp(join(proven.from, page), join(corpus, page));
  if (armSystem(arm) === "openwiki") await cp(join(proven.from, ".claims"), join(corpus, "_claims"), { recursive: true });
}

/** Redacts every secret of the launching environment in the run's files; names the first file and variables found. */
async function redactRun(root: string, files: string[]): Promise<string | null> {
  const secrets = secretValues(process.env);
  let leak: string | null = null;
  for (const file of files) {
    const path = join(root, file);
    if (!(await exists(path))) continue;
    const { text, found } = redactSecrets(await readFile(path, "utf-8"), secrets);
    if (found.length === 0) continue;
    await writeFile(path, text);
    leak ??= `secret in ${file}: ${found.join(", ")}`;
  }
  return leak;
}

export async function runArm(o: RunArmOptions, deps: RunArmDeps = {}): Promise<ArmMeta> {
  const { cloneAt = ensureSourceAt, claudeBin = "claude", corporaDir = CORPORA_ARMS_DIR, resultsDir = RESULTS_ARMS_DIR } = deps;
  const dirs = armDirs(o.workDir, o.repo, o.arm);
  const corpus = join(corporaDir, `${o.repo}-${o.arm}-${o.date}`);
  const kept = join(resultsDir, `${o.repo}-${o.arm}-${o.date}`);
  for (const dir of [dirs.root, corpus, kept]) {
    if (await exists(dir)) throw new Error(`${dir} already exists: a run's folders are never overwritten (one may hold a paid run). Move it away, then run again.`);
  }
  const { repo, sha } = ARM_REPOS[o.repo];
  await cloneAt(repo, sha, dirs.clone);
  await mkdir(dirs.config, { recursive: true });
  const { mcpConfigFile } = await armSetup(o.arm, dirs.clone, o.tools);

  const started = Date.now();
  const transcriptFile = join(dirs.root, "transcript.jsonl");
  let initSeen = false;
  const { stopped, code } = await runClaude(
    claudeBin,
    claudeArgs({ prompt: armPrompt(o.arm, { maxPages: o.maxPages }), mcpConfigFile, model: o.model, effort: o.effort, budgetUsd: o.budgetUsd }),
    {
      cwd: dirs.clone, env: armEnv(process.env, dirs.config, o.credential), timeoutMinutes: o.timeoutMinutes, transcriptFile, stderrFile: join(dirs.root, "stderr.log"),
      watch: (event) => {
        if (initSeen || !isInit(event)) return null;
        initSeen = true;
        const problem = isolationProblem(o.arm, [event]);
        return problem === null ? null : `isolation: ${problem}`;
      },
    },
  );
  const events = (await readFile(transcriptFile, "utf-8")).split("\n").map(parseLine).filter((e) => e !== undefined);
  const result = events.findLast(isResult);
  if (result) await writeFile(join(dirs.root, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  const leak = await redactRun(dirs.root, ["transcript.jsonl", "result.json", "stderr.log"]);
  await mkdir(kept, { recursive: true });
  for (const file of ["transcript.jsonl", "result.json"]) {
    if (await exists(join(dirs.root, file))) await cp(join(dirs.root, file), join(kept, file));
  }

  const proven = await provenPages(o.arm, dirs.clone, events);
  const isolation = isolationProblem(o.arm, events);
  let reason: string | null = null;
  if (stopped !== null) reason = stopped;
  else if (leak !== null) reason = leak;
  else if (!result) reason = `claude exited ${String(code)} without a result`;
  else if (result.subtype !== "success") reason = [result.subtype, ...(result.errors ?? [])].join(": ");
  else if (isolation) reason = `isolation: ${isolation}`;
  else if ("problem" in proven) reason = proven.problem;
  else if (proven.pages.length === 0) reason = "finish not proven: no pages";
  else reason = await corpusLeak(o.arm, proven);

  await mkdir(corpus, { recursive: true });
  const keptPages = reason === null && "pages" in proven ? proven : null;
  if (keptPages) await keepPages(o.arm, keptPages, corpus);

  const meta: ArmMeta = {
    schema_version: 4, system: armSystem(o.arm), arm: o.arm, repo, source_repo_sha: sha, generated_at: new Date().toISOString(),
    model: o.model, effort: o.effort, tool_version: o.toolVersion,
    dry_run: o.maxPages !== undefined, max_pages: o.maxPages ?? null, time_cap_minutes: o.timeoutMinutes, budget_usd: o.budgetUsd, credential: o.credential,
    status: reason === null ? "complete" : "incomplete", reason, page_count: keptPages?.pages.length ?? 0,
    ...runUsage(events),
    cost_usd: result?.total_cost_usd ?? null,
    // The wall clock, as the time cap reads it: a result's duration_ms covers only its own stretch of the main loop.
    duration_ms: Date.now() - started,
  };
  await writeFile(join(corpus, "_meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

/** A run's date: YYYY-MM-DD, or with a lowercase tag (2026-11-15-probe) that keeps a probe's folders apart from the runs it would be compared with. */
export function isRunDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$/.test(date);
}

/** A numeric option's value, or a message naming the option: a positive finite number, whole where `integer`. */
export function positiveOption(name: string, raw: string, { integer = false } = {}): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) {
    throw new Error(`${name} must be a positive ${integer ? "whole " : ""}number, not ${raw}`);
  }
  return n;
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
  if (!isRunDate(values.date ?? "")) fail("--date YYYY-MM-DD (or YYYY-MM-DD-<tag>) is required");
  let credential: ArmCredential = "api-key";
  try {
    credential = armCredential(process.env);
  } catch (err) {
    fail((err as Error).message);
  }
  const maxPages = values["max-pages"] === undefined ? undefined : positiveOption("--max-pages", values["max-pages"], { integer: true });
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
    budgetUsd: positiveOption("--budget", values.budget ?? ""), maxPages,
    timeoutMinutes: values["timeout-minutes"] !== undefined ? positiveOption("--timeout-minutes", values["timeout-minutes"]) : maxPages === undefined ? ARM_TIME_CAPS[repo] : DRY_RUN_TIME_CAP,
    workDir: env.BENCH_WORK_DIR ?? `/work/artifacts/doc0-arms-${new Date().toISOString().slice(0, 10)}`,
    credential, tools, toolVersion,
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
