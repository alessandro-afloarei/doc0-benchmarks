import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runArm, type RunArmOptions } from "./run-arm.ts";
import type { ArmMeta } from "../../scoring/arm-corpus.ts";

const SECRET = "sk-ant-test-never-in-a-file";

// A stand-in for `claude -p`: prints a stream-json transcript and, depending
// on STUB_MODE, writes a finished doc0 or openwiki run into its cwd (the clone).
const STUB = `#!/usr/bin/env bash
set -euo pipefail
echo "$@" > ../claude-args.txt
echo "$CLAUDE_CONFIG_DIR" > ../claude-config-dir.txt
init='{"type":"system","subtype":"init","mcp_servers":[{"name":"'"$STUB_SERVER"'","status":"connected"}],"skills":["'"$STUB_SKILL"'"],"plugins":[]}'
echo "$init"
case "$STUB_MODE" in
  sleep) sleep 30 ;;
  doc0)
    mkdir -p .doc0/pages
    printf -- '---\\ntitle: "Overview"\\n---\\n## Overview\\n\\nfd walks the tree in parallel threads.\\n\\nSources: [src/walk.rs:1-3](repo://src/walk.rs#L1-L3)\\n' > .doc0/pages/overview.md
    ;;
  doc0-unfinished)
    mkdir -p .doc0/pages
    echo '{}' > .doc0/run.json
    printf -- '---\\ntitle: "Overview"\\n---\\n## Overview\\n' > .doc0/pages/overview.md
    ;;
  openwiki)
    mkdir -p openwiki/architecture openwiki/.claims/architecture
    printf -- '---\\ntitle: Walk\\n---\\n# Walk\\n' > openwiki/architecture/walk.md
    printf -- '# Index\\n' > openwiki/index.md
    printf -- '# Index\\n' > openwiki/architecture/index.md
    echo '{"schemaVersion":1,"claims":[]}' > openwiki/.claims/architecture/walk.json
    ;;
esac
subtype="\${STUB_SUBTYPE:-success}"
echo '{"type":"result","subtype":"'"$subtype"'","is_error":false,"duration_ms":120000,"num_turns":7,"total_cost_usd":1.25,"usage":{"input_tokens":10,"cache_creation_input_tokens":20,"cache_read_input_tokens":30,"output_tokens":40},"errors":["budget reached"]}'
`;

let root: string;
let stubBin: string;
let corporaDir: string;
let workDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "run-arm-"));
  stubBin = join(root, "claude");
  await writeFile(stubBin, STUB, { mode: 0o755 });
  corporaDir = join(root, "corpora-arms");
  workDir = join(root, "work");
  await writeFile(join(root, "SKILL.md"), "---\nname: doc0-write\n---\n");
  process.env.ANTHROPIC_API_KEY = SECRET;
});

afterEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  for (const key of ["STUB_MODE", "STUB_SUBTYPE", "STUB_SERVER", "STUB_SKILL"]) delete process.env[key];
  await rm(root, { recursive: true, force: true });
});

function stub(mode: string, arm: "doc0" | "openwiki", subtype = "success") {
  process.env.STUB_MODE = mode;
  process.env.STUB_SUBTYPE = subtype;
  process.env.STUB_SERVER = arm === "doc0" ? "doc0-local" : "openwiki";
  process.env.STUB_SKILL = arm === "doc0" ? "doc0-write" : "openwiki";
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
    timeoutMinutes: 1, workDir, toolVersion: arm === "openwiki" ? "openwiki@0.9.0" : "doc0@0.3.0",
    tools: { doc0Cli, doc0Skill: join(root, "SKILL.md"), openwikiBin: await fakeOpenwiki() },
    ...extra,
  };
}

const deps = () => ({ cloneAt, claudeBin: stubBin, corporaDir });

async function readMeta(dir: string): Promise<ArmMeta> {
  return JSON.parse(await readFile(join(dir, "_meta.json"), "utf-8")) as ArmMeta;
}

describe("runArm", () => {
  it("a finished doc0 run is complete, and its pages become the corpus", async () => {
    stub("doc0", "doc0");
    const meta = await runArm(await options("doc0-map", { maxPages: 3 }), deps());
    expect(meta).toMatchObject({ status: "complete", reason: null, page_count: 1, system: "doc0", arm: "doc0-map", dry_run: true, max_pages: 3 });
    const corpus = join(corporaDir, "fd-doc0-map-2026-11-16");
    expect((await readdir(corpus)).sort()).toEqual(["_meta.json", "overview.md"]);
    expect(await readMeta(corpus)).toEqual(meta);
    const args = await readFile(join(workDir, "fd-doc0-map/claude-args.txt"), "utf-8");
    expect(args).toContain("Plan at most 3 pages.");
    expect(args).toContain(join(workDir, "fd-doc0-map/mcp.json"));
    expect((await readFile(join(workDir, "fd-doc0-map/claude-config-dir.txt"), "utf-8")).trim()).toBe(join(workDir, "fd-doc0-map/claude-config"));
  });

  it("meta copies usage and cost from the result and never the environment", async () => {
    stub("doc0", "doc0");
    const meta = await runArm(await options("doc0-nomap"), deps());
    expect(meta.usage).toEqual({ input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 });
    expect(meta).toMatchObject({ cost_usd: 1.25, duration_ms: 120000, num_turns: 7, time_cap_minutes: 1, tool_version: "doc0@0.3.0" });
    const runRoot = join(workDir, "fd-doc0-nomap");
    for (const file of [join(corporaDir, "fd-doc0-nomap-2026-11-16/_meta.json"), join(runRoot, "result.json"), join(runRoot, "transcript.jsonl")]) {
      expect(await readFile(file, "utf-8"), file).not.toContain(SECRET);
    }
  });

  it("a result without success is incomplete with its reason", async () => {
    stub("doc0", "doc0", "error_max_budget_usd");
    const meta = await runArm(await options("doc0-map"), deps());
    expect(meta.status).toBe("incomplete");
    expect(meta.reason).toBe("error_max_budget_usd: budget reached");
  });

  it("a success whose run never finished is incomplete", async () => {
    stub("doc0-unfinished", "doc0");
    const meta = await runArm(await options("doc0-map"), deps());
    expect(meta).toMatchObject({ status: "incomplete", reason: "finish not reached: .doc0/run.json is still there" });
  });

  it("a run that saw another MCP server is incomplete", async () => {
    stub("doc0", "doc0");
    process.env.STUB_SERVER = "gaja";
    const meta = await runArm(await options("doc0-map"), deps());
    expect(meta.status).toBe("incomplete");
    expect(meta.reason).toMatch(/isolation: .*gaja/);
  });

  it("a run past its time cap is incomplete with the cap as its reason", async () => {
    stub("sleep", "doc0");
    const started = Date.now();
    const meta = await runArm(await options("doc0-map", { timeoutMinutes: 0.02 }), deps());
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(meta).toMatchObject({ status: "incomplete", reason: "time cap 0.02 min", cost_usd: 0 });
  });

  it("an openwiki run keeps its pages without generated index.md and its Claims as _claims", async () => {
    stub("openwiki", "openwiki");
    const meta = await runArm(await options("openwiki"), deps());
    expect(meta).toMatchObject({ status: "complete", system: "openwiki", page_count: 1, tool_version: "openwiki@0.9.0" });
    const corpus = join(corporaDir, "fd-openwiki-2026-11-16");
    expect((await readdir(corpus, { recursive: true })).sort()).toEqual(
      ["_claims", "_claims/architecture", "_claims/architecture/walk.json", "_meta.json", "architecture", "architecture/walk.md"],
    );
  });

  it("refuses a run folder that already exists, so no paid transcript is overwritten", async () => {
    stub("doc0", "doc0");
    await mkdir(join(workDir, "fd-doc0-map"), { recursive: true });
    await expect(runArm(await options("doc0-map"), deps())).rejects.toThrow(/already exists/);
    await expect(stat(join(corporaDir, "fd-doc0-map-2026-11-16"))).rejects.toThrow();
  });
});
