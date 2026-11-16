// Runs one generation arm on one repository: a fresh clone at the corpus SHA,
// the arm installed into it, the host agent headless in an empty config folder
// (Claude Code, or the Codex CLI), then the pages kept as
// corpora/arms/<repo>-<arm>-<date>/ with _meta.json.
//
// Usage:
//   pnpm bench:arm --repo fd|OpenHands|… --arm doc0-map --date 2026-11-16[-<tag>] [--max-pages 3] [--budget 15]
//                  [--timeout-minutes N] [--model claude-opus-5-5] [--effort high]
//   pnpm bench:arm --host codex --model gpt-6-astra --repo fd --arm doc0-map --date 2026-11-16[-<tag>] [--max-pages 3] …
// Environment: claude: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (exactly one); codex: the ChatGPT sign-in in ~/.codex/auth.json,
// copied into the run's folder. DOC0_CLI and DOC0_SKILL (doc0 arms), OPENWIKI_BIN (openwiki),
// BENCH_WORK_DIR (default /work/artifacts/doc0-arms-<today>), DOC0_COMMIT (optional, recorded).

import { spawn } from "node:child_process";
import { constants, createWriteStream, readdirSync, readFileSync, type Dirent } from "node:fs";
import { access, cp, mkdir, open, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { ensureSourceAt } from "../grounding-scorecard.ts";
import type { ArmCredential, ArmHost, ArmMeta, ArmName } from "../../scoring/arm-corpus.ts";
import {
  ARM_TIME_CAPS, ARMS, armCredential, armDirs, armEnv, armFinishTool, armPrompt, armServer, armSetup, armSystem, claudeArgs, codexArgs,
  codexConfigToml, codexIsolationProblem, codexPromptInputArgs, DRY_RUN_TIME_CAP, isolationProblem, jsonSecrets, redactSecrets, RUN_REPOS,
  secretValues, usableDoc0Cli, writeClaudeMcpConfig, type ArmTools, type McpEntry, type RunRepoName,
} from "./arms.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CORPORA_ARMS_DIR = join(ROOT, "corpora", "arms");
/** Each run's transcript and result, beside the judge's raw verdicts (gitignored). */
const RESULTS_ARMS_DIR = join(ROOT, "results", "arms");

export interface RunArmOptions {
  repo: RunRepoName;
  arm: ArmName;
  date: string;
  host: ArmHost;
  model: string;
  effort: string;
  /** claude's spend cap; null on codex, which has none. */
  budgetUsd: number | null;
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
  codexBin?: string;
  /** The ChatGPT sign-in a codex run copies into its own CODEX_HOME. */
  codexAuthFile?: string;
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
 * The processes a run started: every one in the session the agent leads
 * (codex starts its MCP servers in process groups of their own, inside its
 * session), and every descendant of the agent, read from Linux's /proc.
 */
function runProcesses(leader: number): number[] {
  const procs = readdirSync("/proc").filter((d) => /^\d+$/.test(d)).flatMap((d) => {
    try {
      const stat = readFileSync(`/proc/${d}/stat`, "utf-8");
      // After the command's parenthesised name: state, ppid, pgrp, session.
      const [, ppid, , sid] = stat.slice(stat.lastIndexOf(")") + 2).split(" ").map(Number);
      return [{ pid: Number(d), ppid, sid }];
    } catch {
      return []; // the process ended while being read
    }
  });
  const found = new Set(procs.filter((p) => p.sid === leader).map((p) => p.pid));
  for (let grew = true; grew;) {
    const before = found.size;
    for (const p of procs) if (found.has(p.ppid)) found.add(p.pid);
    grew = found.size > before;
  }
  return [...found];
}

/**
 * Runs the agent (claude, or codex) as a session leader and copies its JSONL
 * stdout into the transcript line by line. `watch` sees each event as it
 * arrives and may stop the run (a wrong setup); the time cap stops it too.
 * Stopping, and the agent's own exit, kill its process group and everything
 * else in its session or below it, so no tool or server it started outlives it.
 */
async function runAgent(
  bin: string,
  args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMinutes: number; transcriptFile: string; stderrFile: string; watch: (event: unknown) => string | null },
): Promise<{ stopped: string | null; code: number | null }> {
  const err = await open(o.stderrFile, "w");
  const transcript = createWriteStream(o.transcriptFile);
  try {
    const child = spawn(bin, args, { cwd: o.cwd, env: o.env, detached: true, stdio: ["ignore", "pipe", err.fd] });
    const killGroup = () => {
      if (child.pid === undefined) return;
      for (const target of [-child.pid, ...runProcesses(child.pid)]) {
        try {
          process.kill(target, "SIGKILL");
        } catch {
          // ESRCH: already gone.
        }
      }
    };
    let stopped: string | null = null;
    const stop = (why: string) => {
      stopped ??= why;
      killGroup();
    };
    const timer = setTimeout(() => stop(`time cap ${o.timeoutMinutes} min`), o.timeoutMinutes * 60_000);
    if (child.stdout === null) throw new Error(`${bin}'s stdout is not a pipe`);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      transcript.write(`${line}\n`);
      const problem = o.watch(parseLine(line));
      if (problem !== null) stop(problem);
    });
    // A child left in the group would hold stdout open: the agent's exit reaps it.
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

const asObject = (text: string | undefined): Record<string, unknown> | null => {
  const parsed = text === undefined ? undefined : parseLine(text);
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
};

/** The last result the arm's finish tool returned in claude's transcript, parsed from its JSON text; null when it never returned one. */
export function finishResult(arm: ArmName, events: unknown[]): Record<string, unknown> | null {
  const calls = new Set(events.flatMap(blocks).filter((b) => b.type === "tool_use" && b.name === armFinishTool(arm)).map((b) => b.id));
  const results = events.flatMap(blocks).filter((b) => b.type === "tool_result" && calls.has(b.tool_use_id) && b.is_error !== true);
  const last = results.at(-1)?.content;
  return asObject(typeof last === "string" ? last : last?.find((c) => c.type === "text")?.text);
}

interface CodexItem { type?: string; server?: string; tool?: string; status?: string; error?: unknown; result?: { content?: Array<{ type?: string; text?: string }> } | null }
interface CodexTurn { type: "turn.completed" | "turn.failed"; usage?: { input_tokens?: number; cached_input_tokens?: number; cache_write_input_tokens?: number; output_tokens?: number }; error?: { message?: string } }

const codexItems = (events: unknown[], type: "item.started" | "item.completed"): CodexItem[] =>
  events.flatMap((e) => (typeof e === "object" && e !== null && "type" in e && e.type === type && "item" in e ? [e.item as CodexItem] : []));
const isCodexTurn = (e: unknown): e is CodexTurn =>
  typeof e === "object" && e !== null && "type" in e && (e.type === "turn.completed" || e.type === "turn.failed");

/** The last result the arm's finish tool returned in codex's events (an mcp_tool_call that completed without an error), parsed; null when none did. */
function codexFinishResult(arm: ArmName, events: unknown[]): Record<string, unknown> | null {
  const { server, finish } = armServer(arm);
  const last = codexItems(events, "item.completed")
    .filter((i) => i.type === "mcp_tool_call" && i.server === server && i.tool === finish && i.status === "completed" && i.error == null)
    .at(-1);
  return asObject(last?.result?.content?.find((c) => c.type === "text")?.text);
}

/** The first MCP server other than the arm's that codex called, or null: the stream's half of codex isolation. */
function codexForeignServer(arm: ArmName, events: unknown[]): string | null {
  return codexItems(events, "item.started").find((i) => i.type === "mcp_tool_call" && i.server !== armServer(arm).server)?.server ?? null;
}

/**
 * A codex run's tokens and turns. Each turn.completed reports its own usage,
 * input counting its cached (and cache-written) part, as the OpenAI API does,
 * and output its reasoning: so input_tokens is the uncached rest, in the
 * same shape as claude's. Turns: every completed item but reasoning (a
 * message or a tool call), the nearest to claude's model turns.
 */
export function codexUsage(events: unknown[]): Pick<ArmMeta, "usage" | "num_turns"> {
  const turns = events.filter(isCodexTurn).filter((t) => t.type === "turn.completed");
  if (turns.length === 0) return { usage: null, num_turns: null };
  const sum = (key: keyof NonNullable<CodexTurn["usage"]>) => turns.reduce((n, t) => n + (t.usage?.[key] ?? 0), 0);
  return {
    usage: {
      input_tokens: sum("input_tokens") - sum("cached_input_tokens") - sum("cache_write_input_tokens"),
      cache_creation_input_tokens: sum("cache_write_input_tokens"),
      cache_read_input_tokens: sum("cached_input_tokens"),
      output_tokens: sum("output_tokens"),
    },
    num_turns: codexItems(events, "item.completed").filter((i) => i.type !== "reasoning").length,
  };
}

/** What a host's transcript says about its run, read the same way for both hosts. */
interface Outcome {
  /** The final result event kept as result.json: claude's `result`, codex's last turn.completed or turn.failed. */
  result: unknown;
  /** Why the agent itself did not end well, or null. */
  failure: string | null;
  isolation: string | null;
  finish: Record<string, unknown> | null;
  usage: ArmMeta["usage"];
  num_turns: ArmMeta["num_turns"];
  cost_usd: number | null;
}

function claudeOutcome(arm: ArmName, events: unknown[], code: number | null): Outcome {
  const result = events.findLast(isResult);
  const failure = !result ? `claude exited ${String(code)} without a result`
    : result.subtype !== "success" ? [result.subtype, ...(result.errors ?? [])].join(": ") : null;
  return { result, failure, isolation: isolationProblem(arm, events), finish: finishResult(arm, events), ...runUsage(events), cost_usd: result?.total_cost_usd ?? null };
}

function codexOutcome(arm: ArmName, events: unknown[], code: number | null): Outcome {
  const result = events.findLast(isCodexTurn);
  const failure = !result ? `codex exited ${String(code)} without turn.completed`
    : result.type === "turn.failed" ? `turn.failed: ${result.error?.message ?? "no message"}` : null;
  const foreign = codexForeignServer(arm, events);
  return {
    result, failure, isolation: foreign === null ? null : `codex called MCP server ${foreign}`, finish: codexFinishResult(arm, events),
    ...codexUsage(events), cost_usd: null,
  };
}

/** A finished run's pages and its own navigation files (doc0's navigation.json, openwiki's index.md files), relative to `from`. */
interface Proven { from: string; pages: string[]; navigation: string[] }

/**
 * The pages a finished run proves, relative to where they sit in the clone,
 * or why the run proves none, from the finish tool's last result. doc0:
 * exactly the pages doc0_finish (--no-publish) listed as checked. openwiki:
 * its finish reports no list, and finalizes every page under openwiki/, so
 * every page there but the generated index.md files, which are its navigation.
 */
async function provenPages(arm: ArmName, clone: string, finish: Record<string, unknown> | null): Promise<Proven | { problem: string }> {
  if (armSystem(arm) === "doc0") {
    const from = join(clone, ".doc0", "pages");
    if (finish?.status !== "complete" || finish.published !== false || !Array.isArray(finish.pages)) {
      return { problem: "finish not proven: no doc0_finish result with status complete" };
    }
    const pages = (finish.pages as unknown[]).map((p) => relative(from, String(p)));
    const outside = pages.filter((p) => p.startsWith("..") || !p.endsWith(".md"));
    if (outside.length > 0) return { problem: `doc0_finish listed pages outside .doc0/pages: ${outside.join(", ")}` };
    const navigation = (await exists(join(from, "..", "navigation.json"))) ? ["../navigation.json"] : [];
    return { from, pages: pages.sort(), navigation };
  }
  if (finish?.status !== "complete") return { problem: "finish not proven: no openwiki_finish result with status complete" };
  if (finish.sourceChanged === true) return { problem: "finish not proven: openwiki_finish reported sourceChanged" };
  const from = join(clone, "openwiki");
  if (!(await exists(join(from, ".claims")))) return { problem: "no Claims: openwiki/.claims is missing" };
  const entries: Dirent[] = await readdir(from, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => relative(from, join(e.parentPath, e.name)))
    .filter((rel) => !rel.split("/").some((part) => part.startsWith(".")))
    .sort();
  const isIndex = (rel: string) => basename(rel) === "index.md";
  return { from, pages: files.filter((f) => !isIndex(f)), navigation: files.filter(isIndex) };
}

/** Every file keepPages would copy, relative to `from`: the proven pages, the navigation, and openwiki's Claims files. */
async function corpusFiles(arm: ArmName, proven: Proven): Promise<string[]> {
  if (armSystem(arm) === "doc0") return [...proven.pages, ...proven.navigation];
  const claims = await readdir(join(proven.from, ".claims"), { recursive: true, withFileTypes: true });
  return [...proven.pages, ...proven.navigation, ...claims.filter((e) => e.isFile()).map((e) => relative(proven.from, join(e.parentPath, e.name))).sort()];
}

/** The first file bound for the corpus (which is committed) that holds one of the run's secrets, by name; null when none does. */
async function corpusLeak(arm: ArmName, proven: Proven, secrets: Array<[string, string]>): Promise<string | null> {
  for (const file of await corpusFiles(arm, proven)) {
    const { found } = redactSecrets(await readFile(join(proven.from, file), "utf-8"), secrets);
    if (found.length > 0) return `secret in ${file}: ${found.join(", ")}`;
  }
  return null;
}

/** Copies the proven pages and the navigation into the corpus folder (doc0's navigation.json, outside its pages folder, beside the pages), and openwiki's Claims as _claims. */
async function keepPages(arm: ArmName, proven: Proven, corpus: string): Promise<void> {
  for (const page of proven.pages) await cp(join(proven.from, page), join(corpus, page));
  for (const nav of proven.navigation) await cp(join(proven.from, nav), join(corpus, nav.replace(/^\.\.\//, "")));
  if (armSystem(arm) === "openwiki") await cp(join(proven.from, ".claims"), join(corpus, "_claims"), { recursive: true });
}

/** Redacts every one of the run's secrets in the run's files; names the first file and variables found. */
async function redactRun(root: string, files: string[], secrets: Array<[string, string]>): Promise<string | null> {
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
  const {
    cloneAt = ensureSourceAt, claudeBin = "claude", codexBin = "codex", codexAuthFile = join(homedir(), ".codex", "auth.json"),
    corporaDir = CORPORA_ARMS_DIR, resultsDir = RESULTS_ARMS_DIR,
  } = deps;
  const dirs = armDirs(o.workDir, o.repo, o.arm, o.host);
  const corpus = join(corporaDir, `${o.repo}-${o.arm}-${o.date}`);
  const kept = join(resultsDir, `${o.repo}-${o.arm}-${o.date}`);
  for (const dir of [dirs.root, corpus, kept]) {
    if (await exists(dir)) throw new Error(`${dir} already exists: a run's folders are never overwritten (one may hold a paid run). Move it away, then run again.`);
  }
  const { repo, sha } = RUN_REPOS[o.repo];
  await cloneAt(repo, sha, dirs.clone);
  await mkdir(dirs.config, { recursive: true });
  const { server, entry } = await armSetup(o.arm, dirs.clone, o.tools, o.host);

  const prompt = armPrompt(o.arm, { maxPages: o.maxPages });
  const secrets = secretValues(process.env);
  const transcriptFile = join(dirs.root, "transcript.jsonl");
  const agent = { cwd: dirs.clone, env: armEnv(process.env, dirs.config, o.host, o.credential), timeoutMinutes: o.timeoutMinutes, transcriptFile, stderrFile: join(dirs.root, "stderr.log") };
  const runFiles = ["transcript.jsonl", "result.json", "stderr.log"];
  const started = Date.now();
  let run: { stopped: string | null; code: number | null };
  if (o.host === "claude") {
    if (o.budgetUsd === null) throw new Error("a claude run needs a budget");
    const mcpConfigFile = await writeClaudeMcpConfig(dirs.clone, server, entry);
    let initSeen = false;
    run = await runAgent(claudeBin, claudeArgs({ prompt, mcpConfigFile, model: o.model, effort: o.effort, budgetUsd: o.budgetUsd }), {
      ...agent,
      watch: (event) => {
        if (initSeen || !isInit(event)) return null;
        initSeen = true;
        const problem = isolationProblem(o.arm, [event]);
        return problem === null ? null : `isolation: ${problem}`;
      },
    });
  } else {
    runFiles.push("prompt-input.json");
    run = await runCodex(o, { bin: codexBin, authFile: codexAuthFile, home: dirs.config, root: dirs.root, prompt, server, entry, agent, secrets });
  }
  const { stopped, code } = run;
  // A codex run its prompt-input check stopped never started, and wrote no transcript.
  const events = ((await exists(transcriptFile)) ? await readFile(transcriptFile, "utf-8") : "").split("\n").map(parseLine).filter((e) => e !== undefined);
  const outcome = o.host === "claude" ? claudeOutcome(o.arm, events, code) : codexOutcome(o.arm, events, code);
  if (outcome.result) await writeFile(join(dirs.root, "result.json"), `${JSON.stringify(outcome.result, null, 2)}\n`);
  const leak = await redactRun(dirs.root, runFiles, secrets);
  await mkdir(kept, { recursive: true });
  for (const file of runFiles.filter((f) => f !== "stderr.log")) {
    if (await exists(join(dirs.root, file))) await cp(join(dirs.root, file), join(kept, file));
  }

  const proven = await provenPages(o.arm, dirs.clone, outcome.finish);
  let reason: string | null = null;
  if (stopped !== null) reason = stopped;
  else if (leak !== null) reason = leak;
  else if (outcome.failure !== null) reason = outcome.failure;
  else if (outcome.isolation) reason = `isolation: ${outcome.isolation}`;
  else if ("problem" in proven) reason = proven.problem;
  else if (proven.pages.length === 0) reason = "finish not proven: no pages";
  else reason = await corpusLeak(o.arm, proven, secrets);

  await mkdir(corpus, { recursive: true });
  const keptPages = reason === null && "pages" in proven ? proven : null;
  if (keptPages) await keepPages(o.arm, keptPages, corpus);

  const meta: ArmMeta = {
    schema_version: 4, system: armSystem(o.arm), arm: o.arm, repo, source_repo_sha: sha, generated_at: new Date().toISOString(),
    host: o.host, model: o.model, effort: o.effort, tool_version: o.toolVersion,
    dry_run: o.maxPages !== undefined, max_pages: o.maxPages ?? null, time_cap_minutes: o.timeoutMinutes, budget_usd: o.budgetUsd, credential: o.credential,
    status: reason === null ? "complete" : "incomplete", reason, page_count: keptPages?.pages.length ?? 0,
    usage: outcome.usage, num_turns: outcome.num_turns, cost_usd: outcome.cost_usd,
    // The wall clock, as the time cap reads it: a result's duration_ms covers only its own stretch of the main loop.
    duration_ms: Date.now() - started,
  };
  await writeFile(join(corpus, "_meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

/**
 * A codex run in its own CODEX_HOME: config.toml (runArm's settings, the
 * arm's server alone) and the ChatGPT sign-in copied in with mode 600, its
 * tokens added to the run's secrets and the copy deleted when the run ends.
 * Before `codex exec`, `codex debug prompt-input` renders the prompt the
 * model would get under that home (prompt-input.json): a skill or MCP server
 * other than the arm's stops the run there. During it, a call to another
 * server stops it too.
 */
async function runCodex(
  o: RunArmOptions,
  c: { bin: string; authFile: string; home: string; root: string; prompt: string; server: string; entry: McpEntry; agent: Omit<Parameters<typeof runAgent>[2], "watch">; secrets: Array<[string, string]> },
): Promise<{ stopped: string | null; code: number | null }> {
  await writeFile(join(c.home, "config.toml"), codexConfigToml({ server: c.server, entry: c.entry, model: o.model, effort: o.effort }));
  const auth = await readFile(c.authFile, "utf-8");
  const signIn = JSON.parse(auth) as { auth_mode?: string; last_refresh?: string };
  if (signIn.auth_mode !== "chatgpt") throw new Error(`${c.authFile} is not a ChatGPT sign-in (auth_mode ${String(signIn.auth_mode)}): run \`codex login\`.`);
  c.secrets.push(...jsonSecrets("codex auth.json", signIn));
  const runAuth = join(c.home, "auth.json");
  await writeFile(runAuth, auth, { mode: 0o600 });
  try {
    const check = await runAgent(c.bin, codexPromptInputArgs(c.prompt), {
      ...c.agent, timeoutMinutes: 3, transcriptFile: join(c.root, "prompt-input.json"), stderrFile: join(c.root, "prompt-input.log"), watch: () => null,
    });
    const problem = check.stopped ?? codexIsolationProblem(o.arm, parseLine(await readFile(join(c.root, "prompt-input.json"), "utf-8")));
    if (problem !== null) return { stopped: `isolation: ${problem}`, code: check.code };
    return await runAgent(c.bin, codexArgs(c.prompt), {
      ...c.agent,
      watch: (event) => {
        const foreign = codexForeignServer(o.arm, [event]);
        return foreign === null ? null : `isolation: codex called MCP server ${foreign}`;
      },
    });
  } finally {
    // A refresh spends the old refresh token, so the refreshed sign-in goes back to the user's file, unless that file
    // changed meanwhile (another run or the user refreshed it): then the newer one there stays.
    // A refreshed sign-in holds new tokens: they join the secret scan like the original ones.
    try {
      const refreshed = await readFile(runAuth, "utf-8");
      const after = JSON.parse(refreshed) as { last_refresh?: string };
      if (after.last_refresh !== signIn.last_refresh) {
        c.secrets.push(...jsonSecrets("codex auth.json", after));
        if ((await readFile(c.authFile, "utf-8")) === auth) await writeFile(c.authFile, refreshed, { mode: 0o600 });
        else console.warn(`[bench:arm] codex refreshed its sign-in during the run, and ${c.authFile} changed meanwhile: if codex asks, run \`codex login\`.`);
      }
    } finally {
      await rm(runAuth, { force: true });
    }
  }
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
      "max-pages": { type: "string" }, budget: { type: "string" }, "timeout-minutes": { type: "string" },
      host: { type: "string", default: "claude" }, model: { type: "string" }, effort: { type: "string", default: "high" },
    },
  });
  const host = values.host as ArmHost;
  const repo = values.repo as RunRepoName;
  const arm = values.arm as ArmName;
  const fail = (message: string): never => {
    throw new Error(`[bench:arm] ${message}`);
  };
  if (!Object.hasOwn(RUN_REPOS, repo)) fail(`--repo must be one of ${Object.keys(RUN_REPOS).join(", ")}`);
  if (!(ARMS as readonly string[]).includes(arm)) fail(`--arm must be one of ${ARMS.join(", ")}`);
  if (!isRunDate(values.date ?? "")) fail("--date YYYY-MM-DD (or YYYY-MM-DD-<tag>) is required");
  if (host !== "claude" && host !== "codex") fail("--host must be claude or codex");
  // The model never picks the host: codex has no default model, and only claude has a spend cap.
  if (host === "codex" && values.model === undefined) fail("--host codex needs --model (gpt-6.1-sol, gpt-6-astra, …)");
  if (host === "codex" && values.budget !== undefined) fail("--budget is claude's spend cap: codex has none, only the time cap");
  let credential: ArmCredential = "subscription";
  if (host === "claude") {
    try {
      credential = armCredential(process.env);
    } catch (err) {
      fail((err as Error).message);
    }
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
    repo, arm, date: values.date ?? "", host, model: values.model ?? "claude-opus-5-5", effort: values.effort ?? "",
    budgetUsd: host === "codex" ? null : positiveOption("--budget", values.budget ?? "15"), maxPages,
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
