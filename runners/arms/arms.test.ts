import { describe, it, expect } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARMS,
  ARM_REPOS,
  ARM_TIME_CAPS,
  armDirs,
  armEnv,
  armPrompt,
  armSetup,
  capMinutes,
  claudeArgs,
  CLOUD_PAGE_COUNTS,
  isolationProblem,
  MINUTES_PER_PAGE,
  redactSecrets,
  REPOS,
  secretValues,
  usableDoc0Cli,
} from "./arms.ts";

describe("claudeArgs", () => {
  it("claudeArgs pins model, effort, strict MCP, project settings and the budget", () => {
    const args = claudeArgs({ prompt: "P", mcpConfigFile: "/w/mcp.json", model: "claude-opus-5-5", effort: "high", budgetUsd: 15 });
    expect(args).toEqual([
      "-p", "P",
      "--output-format", "stream-json", "--verbose",
      "--model", "claude-opus-5-5",
      "--effort", "high",
      "--mcp-config", "/w/mcp.json",
      "--strict-mcp-config",
      "--setting-sources", "project",
      "--max-budget-usd", "15",
      "--dangerously-skip-permissions",
      "--no-session-persistence",
    ]);
  });
});

describe("armPrompt", () => {
  it("armPrompt differs between arms only by skill name", () => {
    const [openwiki, map, nomap] = ARMS.map((arm) => armPrompt(arm, {}));
    expect(map).toBe(nomap);
    expect(openwiki.replace("the openwiki skill", "the doc0-write skill")).toBe(map);
    expect(map).toBe(
      "Create the documentation for this repository with the doc0-write skill: start a new run in init mode and finish it. " +
        "Do not ask questions; work until the finish step reports complete.",
    );
  });

  it("caps the plan when maxPages is given", () => {
    expect(armPrompt("openwiki", { maxPages: 3 })).toMatch(/ Plan at most 3 pages\.$/);
  });
});

describe("armSetup", () => {
  async function setUp(arm: (typeof ARMS)[number]) {
    const root = await mkdtemp(join(tmpdir(), "arm-setup-"));
    const clone = join(root, "src");
    await mkdir(clone);
    const doc0Skill = join(root, "SKILL.md");
    await writeFile(doc0Skill, "---\nname: doc0-write\n---\n");
    const setup = await armSetup(arm, clone, { doc0Cli: "/opt/doc0-cli/node_modules/.bin/doc0", doc0Skill, openwikiBin: "/opt/ow" });
    const mcp = JSON.parse(await readFile(setup.mcpConfigFile, "utf-8")) as { mcpServers: Record<string, { command: string; args: string[] }> };
    return { root, clone, setup, mcp };
  }

  it("doc0-nomap's MCP file adds --no-map, doc0-map's does not", async () => {
    const map = await setUp("doc0-map");
    const nomap = await setUp("doc0-nomap");
    expect(map.mcp.mcpServers["doc0-local"].args).toEqual(["mcp", "--no-publish"]);
    expect(nomap.mcp.mcpServers["doc0-local"].args).toEqual(["mcp", "--no-publish", "--no-map"]);
    await Promise.all([rm(map.root, { recursive: true }), rm(nomap.root, { recursive: true })]);
  });

  it("the doc0 arms' MCP file runs DOC0_CLI directly, and the skill sits in the clone", async () => {
    const { root, clone, setup, mcp } = await setUp("doc0-map");
    expect(Object.keys(mcp.mcpServers)).toEqual(["doc0-local"]);
    expect(mcp.mcpServers["doc0-local"].command).toBe("/opt/doc0-cli/node_modules/.bin/doc0");
    expect(setup.skillName).toBe("doc0-write");
    expect(setup.mcpConfigFile.startsWith(clone)).toBe(false);
    expect(await readFile(join(clone, ".claude/skills/doc0-write/SKILL.md"), "utf-8")).toContain("name: doc0-write");
    await rm(root, { recursive: true });
  });
});

describe("armDirs", () => {
  it("each arm and repository gets its own clone and config directory", () => {
    const seen = new Set<string>();
    for (const repo of REPOS) {
      for (const arm of ARMS) {
        const dirs = armDirs("/w", repo, arm);
        for (const dir of [dirs.root, dirs.clone, dirs.config]) {
          expect(seen.has(dir), dir).toBe(false);
          seen.add(dir);
        }
        expect(dirs.clone.startsWith(dirs.root)).toBe(true);
        expect(dirs.config.startsWith(dirs.clone)).toBe(false);
      }
    }
    expect(seen.size).toBe(REPOS.length * ARMS.length * 3);
  });
});

describe("time caps", () => {
  it("capMinutes is ceil(1.5 × m × pages) + 15", () => {
    expect(capMinutes(4, CLOUD_PAGE_COUNTS.fd)).toBe(153);
    expect(capMinutes(4, CLOUD_PAGE_COUNTS.hono)).toBe(189);
    expect(capMinutes(4, CLOUD_PAGE_COUNTS.celery)).toBe(285);
  });

  it("ARM_TIME_CAPS come from capMinutes and MINUTES_PER_PAGE", () => {
    for (const repo of REPOS) expect(ARM_TIME_CAPS[repo]).toBe(capMinutes(MINUTES_PER_PAGE, CLOUD_PAGE_COUNTS[repo]));
  });

  it("pins the three repositories at their 2026-07 corpus SHAs", () => {
    expect(ARM_REPOS).toEqual({
      hono: { repo: "honojs/hono", sha: "b2ae3a2204a48ce15a26448fd746d39745eb1837" },
      fd: { repo: "sharkdp/fd", sha: "41532d114e2ba565fb5367d606c111b29b96450c" },
      celery: { repo: "celery/celery", sha: "1432d9b6c6868a77e7ee2ede1650da00a8d187ac" },
    });
  });
});

describe("usableDoc0Cli", () => {
  it("a DOC0_CLI under packages/cli/dist is refused", async () => {
    const root = await mkdtemp(join(tmpdir(), "doc0-cli-"));
    const dist = join(root, "packages/cli/dist");
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, "index.js"), "#!/usr/bin/env node\n", { mode: 0o755 });
    expect(await usableDoc0Cli(join(dist, "index.js"))).toMatch(/packages\/cli\/dist/);
    await rm(root, { recursive: true });
  });

  it("refuses a missing or non-executable file and accepts a packed install's binary", async () => {
    const root = await mkdtemp(join(tmpdir(), "doc0-cli-"));
    const bin = join(root, "node_modules/.bin/doc0");
    await mkdir(join(root, "node_modules/.bin"), { recursive: true });
    expect(await usableDoc0Cli(undefined)).toMatch(/DOC0_CLI/);
    expect(await usableDoc0Cli(bin)).toMatch(/not an executable file/);
    await writeFile(bin, "#!/usr/bin/env node\n", { mode: 0o644 });
    expect(await usableDoc0Cli(bin)).toMatch(/not an executable file/);
    await chmod(bin, 0o755);
    expect(await usableDoc0Cli(bin)).toBeNull();
    await rm(root, { recursive: true });
  });
});

describe("isolationProblem", () => {
  const init = (mcp: string[], skills: string[], plugins: string[] = [], status = "connected") => ({
    type: "system", subtype: "init",
    mcp_servers: mcp.map((name) => ({ name, status })),
    skills, plugins: plugins.map((name) => ({ name, path: `/p/${name}` })),
  });

  it("accepts a run that saw only the arm's server and skill (built-in skills aside)", () => {
    expect(isolationProblem("doc0-map", [init(["doc0-local"], ["doc0-write", "simplify"])])).toBeNull();
  });

  it("names another MCP server, a missing skill, a plugin, or no init event", () => {
    expect(isolationProblem("doc0-map", [init(["doc0-local", "gaja"], ["doc0-write"])])).toMatch(/gaja/);
    expect(isolationProblem("openwiki", [init(["openwiki"], ["simplify"])])).toMatch(/openwiki skill/);
    expect(isolationProblem("openwiki", [init(["openwiki"], ["openwiki"], ["superpowers"])])).toMatch(/superpowers/);
    expect(isolationProblem("openwiki", [])).toMatch(/no init event/);
    expect(isolationProblem("doc0-nomap", [init(["doc0-local"], ["doc0-write", "openwiki"])])).toMatch(/openwiki/);
  });

  it("names the arm's server when its status is anything but connected", () => {
    for (const status of ["failed", "pending", "needs-auth"]) {
      expect(isolationProblem("doc0-map", [init(["doc0-local"], ["doc0-write"], [], status)])).toBe(`MCP server doc0-local is ${status}, not connected`);
    }
  });
});

describe("armEnv", () => {
  it("passes the allowlist only: no CLAUDE_CODE_* messaging, no judge keys, HOME and the config dir isolated", () => {
    const parent = {
      PATH: "/usr/bin", LANG: "C.UTF-8", TMPDIR: "/work/tmp", ANTHROPIC_API_KEY: "sk-ant-x",
      HOME: "/home/orca", CLAUDECODE: "1", CLAUDE_CODE_MESSAGING_SOCKET: "/run/s.sock", CLAUDE_CODE_SESSION_ID: "abc",
      GOOGLE_GENERATIVE_AI_API_KEY: "g-key", ANTHROPIC_BASE_URL: "https://proxy", MAX_THINKING_TOKENS: "1",
    };
    expect(armEnv(parent, "/w/fd-doc0-map/claude-config")).toEqual({
      PATH: "/usr/bin", LANG: "C.UTF-8", TMPDIR: "/work/tmp", ANTHROPIC_API_KEY: "sk-ant-x",
      HOME: "/w/fd-doc0-map/claude-config", CLAUDE_CONFIG_DIR: "/w/fd-doc0-map/claude-config",
    });
  });
});

describe("secrets", () => {
  const env = { ANTHROPIC_API_KEY: "sk-ant-api03-secret", GEMINI_API_KEY: "AIza-judge-key", GITHUB_TOKEN: "ghp_123456789", PATH: "/usr/bin", SHORT_KEY: "abc" };

  it("secretValues takes the secret-looking variables of 8 characters or more", () => {
    expect(secretValues(env)).toEqual([["ANTHROPIC_API_KEY", "sk-ant-api03-secret"], ["GEMINI_API_KEY", "AIza-judge-key"], ["GITHUB_TOKEN", "ghp_123456789"]]);
  });

  it("redactSecrets replaces every value and names each variable found", () => {
    const text = 'env: ANTHROPIC_API_KEY=sk-ant-api03-secret\n{"k":"AIza-judge-key","again":"sk-ant-api03-secret"}';
    expect(redactSecrets(text, secretValues(env))).toEqual({
      text: 'env: ANTHROPIC_API_KEY=[REDACTED ANTHROPIC_API_KEY]\n{"k":"[REDACTED GEMINI_API_KEY]","again":"[REDACTED ANTHROPIC_API_KEY]"}',
      found: ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"],
    });
    expect(redactSecrets("clean", secretValues(env))).toEqual({ text: "clean", found: [] });
  });
});
