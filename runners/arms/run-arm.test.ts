import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { positiveOption, runArm, type RunArmOptions } from "./run-arm.ts";
import type { ArmMeta } from "../../scoring/arm-corpus.ts";

const SECRET = "sk-ant-test-never-in-a-file";
const TOKEN = "sk-ant-oat-test-never-in-a-file";

// A stand-in for `claude -p`. The arm's environment is an allowlist, so the
// stub reads what to do from stub-mode.json beside itself: it prints a
// stream-json transcript (init, the finish tool's call and result, the final
// result) and writes the files a doc0 or openwiki run leaves in its cwd.
const STUB = String.raw`#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const mode = JSON.parse(readFileSync(join(dirname(process.argv[1]), "stub-mode.json"), "utf-8"));
const out = (e) => console.log(JSON.stringify(e));
const file = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
writeFileSync("../claude-args.txt", process.argv.slice(2).join(" "));
writeFileSync("../claude-env.json", JSON.stringify(process.env));
out({ type: "system", subtype: "init", mcp_servers: [{ name: mode.server, status: mode.status ?? "connected" }], skills: [mode.skill], plugins: [] });
const finish = (tool, result) => {
  out({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_9", name: "mcp__" + mode.server + "__" + tool, input: { runId: "r" } }] } });
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_9", content: [{ type: "text", text: JSON.stringify(result) }] }] } });
};
const page = (title) => '---\ntitle: "' + title + '"\n---\n## Overview\n\nfd walks the tree in parallel threads.' + (mode.leakPage ? " Key: " + process.env.ANTHROPIC_API_KEY : "") + '\n\nSources: [src/walk.rs:1-3](repo://src/walk.rs#L1-L3)\n';
if (mode.child) {
  const child = spawn("sleep", ["300"], { stdio: ["ignore", "inherit", "ignore"] });
  child.unref();
  writeFileSync("../child.pid", String(child.pid));
}
if (mode.sleep) setTimeout(() => {}, mode.sleep * 1000);
else {
  if (mode.doc0) {
    file(".doc0/pages/overview.md", page("Overview"));
    file(".doc0/pages/stray-draft.md", page("Stray draft"));
    if (mode.doc0 !== "none") finish("doc0_finish", mode.doc0 === "pending" ? { status: "pending", pages: ["overview"] } : { status: "complete", published: false, pages: [join(process.cwd(), ".doc0/pages/overview.md")] });
  }
  if (mode.openwiki) {
    file("openwiki/architecture/walk.md", "---\ntitle: Walk\n---\n# Walk\n");
    file("openwiki/index.md", "# Index\n");
    file("openwiki/architecture/index.md", "# Index\n");
    if (mode.openwiki !== "no-claims") file("openwiki/.claims/architecture/walk.json", JSON.stringify({ schemaVersion: 1, claims: mode.leakPage ? [{ statement: process.env.ANTHROPIC_API_KEY, evidence: [] }] : [] }));
    finish("openwiki_finish", mode.openwiki === "source-changed" ? { status: "complete", sourceChanged: true } : { status: "complete" });
  }
  if (mode.leak) out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "credential=" + (process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_CODE_OAUTH_TOKEN) }] } });
  if (mode.subtype !== "none") out({ type: "result", subtype: mode.subtype ?? "success", duration_ms: 120000, num_turns: 7, total_cost_usd: 1.25, usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 }, errors: ["budget reached"] });
}
`;

let root: string;
let stubBin: string;
let corporaDir: string;
let resultsDir: string;
let workDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "run-arm-"));
  stubBin = join(root, "claude");
  await writeFile(stubBin, STUB, { mode: 0o755 });
  corporaDir = join(root, "corpora-arms");
  resultsDir = join(root, "results-arms");
  workDir = join(root, "work");
  await writeFile(join(root, "SKILL.md"), "---\nname: doc0-write\n---\n");
  process.env.ANTHROPIC_API_KEY = SECRET;
});

afterEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await rm(root, { recursive: true, force: true });
});

interface StubMode { leakPage?: boolean; doc0?: "complete" | "pending" | "none"; openwiki?: "complete" | "no-claims" | "source-changed"; subtype?: string; sleep?: number; child?: boolean; leak?: boolean; status?: string; server?: string }

async function stub(mode: StubMode) {
  const doc0 = mode.openwiki === undefined;
  await writeFile(join(root, "stub-mode.json"), JSON.stringify({ server: doc0 ? "doc0-local" : "openwiki", skill: doc0 ? "doc0-write" : "openwiki", ...mode }));
}

// The clone is a plain folder holding one source file; the real runner clones from GitHub.
const cloneAt = async (_repo: string, _sha: string, dir: string): Promise<string> => {
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src/walk.rs"), "fn walk() {}\nfn a() {}\nfn b() {}\n");
  return dir;
};

// openwiki's own install is replaced by a fake binary that writes its skill, as `integrations install claude --project .` does.
async function fakeOpenwiki(): Promise<string> {
  const bin = join(root, "openwiki");
  await writeFile(bin, "#!/usr/bin/env bash\nmkdir -p .claude/skills/openwiki && echo '---' > .claude/skills/openwiki/SKILL.md\n", { mode: 0o755 });
  return bin;
}

async function options(arm: RunArmOptions["arm"], extra: Partial<RunArmOptions> = {}): Promise<RunArmOptions> {
  const doc0Cli = join(root, "doc0");
  await writeFile(doc0Cli, "#!/usr/bin/env node\n", { mode: 0o755 });
  return {
    repo: "fd", arm, date: "2026-11-16", model: "claude-opus-5-5", effort: "high", budgetUsd: 15,
    timeoutMinutes: 1, workDir, credential: "api-key", toolVersion: arm === "openwiki" ? "openwiki@0.9.0" : "doc0@0.3.0",
    tools: { doc0Cli, doc0Skill: join(root, "SKILL.md"), openwikiBin: await fakeOpenwiki() },
    ...extra,
  };
}

const deps = () => ({ cloneAt, claudeBin: stubBin, corporaDir, resultsDir });

async function readMeta(dir: string): Promise<ArmMeta> {
  return JSON.parse(await readFile(join(dir, "_meta.json"), "utf-8")) as ArmMeta;
}

async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

describe("runArm", () => {
  it("a doc0 run is complete on doc0_finish's result, and keeps exactly the pages it lists", async () => {
    await stub({ doc0: "complete" });
    const meta = await runArm(await options("doc0-map", { maxPages: 3 }), deps());
    expect(meta).toMatchObject({
      schema_version: 4, status: "complete", reason: null, page_count: 1, system: "doc0", arm: "doc0-map", credential: "api-key",
      dry_run: true, max_pages: 3, budget_usd: 15, time_cap_minutes: 1, model: "claude-opus-5-5", effort: "high",
      source_repo_sha: "41532d114e2ba565fb5367d606c111b29b96450c",
    });
    const corpus = join(corporaDir, "fd-doc0-map-2026-11-16");
    expect((await readdir(corpus)).sort()).toEqual(["_meta.json", "overview.md"]);
    expect(await readMeta(corpus)).toEqual(meta);
    const args = await readFile(join(workDir, "fd-doc0-map/claude-args.txt"), "utf-8");
    expect(args).toContain("Plan at most 3 pages.");
    expect(args).toContain(join(workDir, "fd-doc0-map/mcp.json"));
  });

  it("the arm gets the allowlisted environment only, with its own config folder", async () => {
    await stub({ doc0: "complete" });
    process.env.CLAUDE_CODE_MESSAGING_SOCKET = "/run/peer.sock";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "judge-key-1234";
    try {
      await runArm(await options("doc0-map"), deps());
    } finally {
      delete process.env.CLAUDE_CODE_MESSAGING_SOCKET;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    }
    const env = JSON.parse(await readFile(join(workDir, "fd-doc0-map/claude-env.json"), "utf-8")) as Record<string, string>;
    const config = join(workDir, "fd-doc0-map/claude-config");
    expect(env).toMatchObject({ CLAUDE_CONFIG_DIR: config, HOME: config, ANTHROPIC_API_KEY: SECRET });
    expect(Object.keys(env).filter((k) => !["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "ANTHROPIC_API_KEY", "HOME", "CLAUDE_CONFIG_DIR"].includes(k))).toEqual([]);
  });

  it("meta copies usage and cost from the result, and the transcript and result are kept under results/", async () => {
    await stub({ doc0: "complete" });
    const meta = await runArm(await options("doc0-nomap"), deps());
    expect(meta.usage).toEqual({ input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 });
    expect(meta).toMatchObject({ cost_usd: 1.25, duration_ms: 120000, num_turns: 7, tool_version: "doc0@0.3.0" });
    const kept = join(resultsDir, "fd-doc0-nomap-2026-11-16");
    expect((await readdir(kept)).sort()).toEqual(["result.json", "transcript.jsonl"]);
    expect(await readFile(join(kept, "transcript.jsonl"), "utf-8")).toContain('"subtype":"init"');
    for (const file of [join(corporaDir, "fd-doc0-nomap-2026-11-16/_meta.json"), join(kept, "result.json"), join(kept, "transcript.jsonl")]) {
      expect(await readFile(file, "utf-8"), file).not.toContain(SECRET);
    }
  });

  it("a key that reaches the transcript makes the run incomplete, and every copy is redacted", async () => {
    await stub({ doc0: "complete", leak: true });
    const meta = await runArm(await options("doc0-map"), deps());
    expect(meta).toMatchObject({ status: "incomplete", reason: "secret in transcript.jsonl: ANTHROPIC_API_KEY" });
    for (const file of [join(workDir, "fd-doc0-map/transcript.jsonl"), join(resultsDir, "fd-doc0-map-2026-11-16/transcript.jsonl")]) {
      const text = await readFile(file, "utf-8");
      expect(text).not.toContain(SECRET);
      expect(text).toContain("[REDACTED ANTHROPIC_API_KEY]");
    }
  });

  it("a subscription run gets the token alone, records its kind and never its value, and the token is scanned like a key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = TOKEN;
    try {
      await stub({ doc0: "complete", leak: true });
      const meta = await runArm(await options("doc0-map", { credential: "subscription" }), deps());
      expect(meta).toMatchObject({ credential: "subscription", status: "incomplete", reason: "secret in transcript.jsonl: CLAUDE_CODE_OAUTH_TOKEN" });
      const env = JSON.parse(await readFile(join(workDir, "fd-doc0-map/claude-env.json"), "utf-8")) as Record<string, string>;
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
      expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
      for (const file of [join(corporaDir, "fd-doc0-map-2026-11-16/_meta.json"), join(resultsDir, "fd-doc0-map-2026-11-16/transcript.jsonl")]) {
        expect(await readFile(file, "utf-8"), file).not.toContain(TOKEN);
      }
    } finally {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }
  });

  it("a key in a page or a Claims file keeps the run out of the corpus", async () => {
    await stub({ doc0: "complete", leakPage: true });
    expect(await runArm(await options("doc0-map"), deps())).toMatchObject({ status: "incomplete", reason: "secret in overview.md: ANTHROPIC_API_KEY", page_count: 0 });
    expect(await readdir(join(corporaDir, "fd-doc0-map-2026-11-16"))).toEqual(["_meta.json"]);
    await stub({ openwiki: "complete", leakPage: true });
    expect(await runArm(await options("openwiki"), deps())).toMatchObject({ status: "incomplete", reason: "secret in .claims/architecture/walk.json: ANTHROPIC_API_KEY" });
    expect(await readdir(join(corporaDir, "fd-openwiki-2026-11-16"))).toEqual(["_meta.json"]);
  });

  it("pages written without a doc0_finish result are not a run: incomplete, and nothing is kept", async () => {
    await stub({ doc0: "none" });
    const meta = await runArm(await options("doc0-map"), deps());
    expect(meta).toMatchObject({ status: "incomplete", reason: "finish not proven: no doc0_finish result with status complete", page_count: 0 });
    expect(await readdir(join(corporaDir, "fd-doc0-map-2026-11-16"))).toEqual(["_meta.json"]);
  });

  it("a doc0_finish that answers pending is not a finish", async () => {
    await stub({ doc0: "pending" });
    const meta = await runArm(await options("doc0-map"), deps());
    expect(meta).toMatchObject({ status: "incomplete", reason: "finish not proven: no doc0_finish result with status complete" });
  });

  it("a result without success is incomplete with its reason", async () => {
    await stub({ doc0: "complete", subtype: "error_max_budget_usd" });
    const meta = await runArm(await options("doc0-map"), deps());
    expect(meta).toMatchObject({ status: "incomplete", reason: "error_max_budget_usd: budget reached" });
  });

  it("a run without a final result records its spend as unknown, never 0", async () => {
    await stub({ doc0: "complete", subtype: "none" });
    const meta = await runArm(await options("doc0-map"), deps());
    expect(meta).toMatchObject({ status: "incomplete", reason: "claude exited 0 without a result", usage: null, cost_usd: null, num_turns: null });
  });

  it("a wrong setup in the init event stops the run at once", async () => {
    await stub({ server: "gaja", sleep: 30 });
    const started = Date.now();
    const meta = await runArm(await options("doc0-map"), deps());
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(meta.status).toBe("incomplete");
    expect(meta.reason).toMatch(/^isolation: .*gaja/);
  });

  it("a server whose status is not connected stops the run at once", async () => {
    await stub({ status: "failed", sleep: 30 });
    const meta = await runArm(await options("doc0-map"), deps());
    expect(meta.reason).toBe("isolation: MCP server doc0-local is failed, not connected");
  });

  it("the time cap kills the whole process group, a tool's child included", async () => {
    await stub({ sleep: 30, child: true });
    const started = Date.now();
    const meta = await runArm(await options("doc0-map", { timeoutMinutes: 0.02 }), deps());
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(meta).toMatchObject({ status: "incomplete", reason: "time cap 0.02 min", cost_usd: null });
    expect(await gone(Number(await readFile(join(workDir, "fd-doc0-map/child.pid"), "utf-8")))).toBe(true);
  });

  it("a child left behind by a finished run is killed too", async () => {
    await stub({ doc0: "complete", child: true });
    const meta = await runArm(await options("doc0-map"), deps());
    expect(meta.status).toBe("complete");
    expect(await gone(Number(await readFile(join(workDir, "fd-doc0-map/child.pid"), "utf-8")))).toBe(true);
  });

  it("an openwiki run is complete on openwiki_finish's result and keeps its pages without index.md, and its Claims", async () => {
    await stub({ openwiki: "complete" });
    const meta = await runArm(await options("openwiki"), deps());
    expect(meta).toMatchObject({ status: "complete", system: "openwiki", page_count: 1, tool_version: "openwiki@0.9.0" });
    const corpus = join(corporaDir, "fd-openwiki-2026-11-16");
    expect((await readdir(corpus, { recursive: true })).sort()).toEqual(
      ["_claims", "_claims/architecture", "_claims/architecture/walk.json", "_meta.json", "architecture", "architecture/walk.md"],
    );
  });

  it("an openwiki run without its Claims folder, or whose source changed, is incomplete", async () => {
    await stub({ openwiki: "no-claims" });
    expect(await runArm(await options("openwiki"), deps())).toMatchObject({ status: "incomplete", reason: "no Claims: openwiki/.claims is missing" });
    await rm(workDir, { recursive: true });
    await rm(corporaDir, { recursive: true });
    await rm(resultsDir, { recursive: true });
    await stub({ openwiki: "source-changed" });
    expect(await runArm(await options("openwiki"), deps())).toMatchObject({ status: "incomplete", reason: "finish not proven: openwiki_finish reported sourceChanged" });
  });

  it("refuses a run folder, a corpus folder or a results folder that already exists, before anything runs", async () => {
    await stub({ doc0: "complete" });
    for (const existing of [join(workDir, "fd-doc0-map"), join(corporaDir, "fd-doc0-map-2026-11-16"), join(resultsDir, "fd-doc0-map-2026-11-16")]) {
      await mkdir(existing, { recursive: true });
      await expect(runArm(await options("doc0-map"), deps())).rejects.toThrow(`${existing} already exists`);
      await rm(existing, { recursive: true });
      await expect(stat(join(workDir, "fd-doc0-map", "transcript.jsonl"))).rejects.toThrow();
    }
  });
});

describe("positiveOption", () => {
  it("takes a positive finite number, and an integer where asked", () => {
    expect(positiveOption("--budget", "15")).toBe(15);
    expect(positiveOption("--timeout-minutes", "0.5")).toBe(0.5);
    expect(positiveOption("--max-pages", "3", { integer: true })).toBe(3);
  });

  it("refuses NaN, zero, negatives and fractions of a page, naming the option", () => {
    expect(() => positiveOption("--timeout-minutes", "90m")).toThrow("--timeout-minutes must be a positive number, not 90m");
    expect(() => positiveOption("--budget", "0")).toThrow("--budget must be a positive number, not 0");
    expect(() => positiveOption("--budget", "-1")).toThrow(/--budget/);
    expect(() => positiveOption("--budget", "Infinity")).toThrow(/--budget/);
    expect(() => positiveOption("--max-pages", "2.5", { integer: true })).toThrow("--max-pages must be a positive whole number, not 2.5");
  });
});
