import { describe, it, expect } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARMS,
  ARM_REPOS,
  ARM_TIME_CAPS,
  armDirs,
  armCredential,
  armEnv,
  armPrompt,
  armSetup,
  capMinutes,
  claudeArgs,
  CLOUD_PAGE_COUNTS,
  CODEWIKIBENCH_REPOS,
  isolationProblem,
  MINUTES_PER_PAGE,
  redactSecrets,
  REPOS,
  RUN_REPOS,
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
    const repos = Object.keys(RUN_REPOS) as (keyof typeof RUN_REPOS)[];
    for (const repo of repos) {
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
    expect(seen.size).toBe(repos.length * ARMS.length * 3);
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
    expect(ARM_TIME_CAPS).toEqual({
      hono: 68, fd: 57, celery: 96,
      OpenHands: 96, svelte: 91, puppeteer: 75, "ml-agents": 84, logstash: 96, wazuh: 96, electron: 96,
    });
  });

  it("the full run, the one the decision rules read, stays hono, fd and celery", () => {
    expect(REPOS).toEqual(["hono", "fd", "celery"]);
    expect(RUN_REPOS).toEqual({ ...ARM_REPOS, ...CODEWIKIBENCH_REPOS });
  });

  it("pins the seven CodeWikiBench repositories at the dataset's commits, under the dataset's repo_name", () => {
    expect(CODEWIKIBENCH_REPOS).toEqual({
      OpenHands: { repo: "All-Hands-AI/OpenHands", sha: "30604c40fc6e9ac914089376f41e118582954f22" },
      svelte: { repo: "sveltejs/svelte", sha: "be645b4d9f84cb7580683c7b2336d1023906c4da" },
      puppeteer: { repo: "puppeteer/puppeteer", sha: "c1105f125c71353587a837958c2748097ef2927d" },
      "ml-agents": { repo: "Unity-Technologies/ml-agents", sha: "4cf2f49ad0a973c95eb41325aa3a46959f187708" },
      logstash: { repo: "elastic/logstash", sha: "895cfa5b14633ae9b9e671105f7b7935c9f2b9f1" },
      wazuh: { repo: "wazuh/wazuh", sha: "44b7cd33e05abb7730228bb092b23b419ee4f15e" },
      electron: { repo: "electron/electron", sha: "828fd59a72e673acf03f878b4f488a40fca46dfe" },
    });
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

  it("accepts the plugins Claude Code itself ships (path builtin), as 2.1.323's init event lists them", () => {
    const builtin = ["cc-plugin-sec-default", "cc-plugin-telemetry"].map((name) => ({ name, path: "builtin", source: `${name}@builtin` }));
    expect(isolationProblem("doc0-map", [{ ...init(["doc0-local"], ["doc0-write"]), plugins: builtin }])).toBeNull();
  });

  it("names a plugin that is not builtin, even one that calls itself builtin by name or source alone", () => {
    for (const plugin of [{ name: "superpowers", path: "/home/u/.claude/plugins/superpowers", source: "superpowers@builtin" }, { name: "x", path: "builtin", source: "x@marketplace" }]) {
      expect(isolationProblem("doc0-map", [{ ...init(["doc0-local"], ["doc0-write"]), plugins: [plugin] }])).toBe(`plugins loaded: ${plugin.name}`);
    }
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

describe("armCredential", () => {
  it("names the one credential set: an API key or a subscription token", () => {
    expect(armCredential({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("api-key");
    expect(armCredential({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-x" })).toBe("subscription");
  });

  it("refuses both or neither, naming the two variables", () => {
    expect(() => armCredential({ ANTHROPIC_API_KEY: "a", CLAUDE_CODE_OAUTH_TOKEN: "b" })).toThrow(
      "both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set: set exactly one, so every arm runs on the same credential.",
    );
    for (const env of [{}, { ANTHROPIC_API_KEY: "" }]) {
      expect(() => armCredential(env)).toThrow(
        "neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set: each run's config folder starts empty, with no login.",
      );
    }
  });
});

describe("armEnv", () => {
  const parent = {
    PATH: "/usr/bin", LANG: "C.UTF-8", TMPDIR: "/work/tmp", ANTHROPIC_API_KEY: "sk-ant-x", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-x",
    HOME: "/home/orca", CLAUDECODE: "1", CLAUDE_CODE_MESSAGING_SOCKET: "/run/s.sock", CLAUDE_CODE_SESSION_ID: "abc",
    GOOGLE_GENERATIVE_AI_API_KEY: "g-key", ANTHROPIC_BASE_URL: "https://proxy", MAX_THINKING_TOKENS: "1",
  };
  const isolated = { PATH: "/usr/bin", LANG: "C.UTF-8", TMPDIR: "/work/tmp", HOME: "/w/fd-doc0-map/claude-config", CLAUDE_CONFIG_DIR: "/w/fd-doc0-map/claude-config" };

  it("passes the allowlist and the run's one credential only: no CLAUDE_CODE_* messaging, no judge keys, HOME and the config dir isolated", () => {
    expect(armEnv(parent, "/w/fd-doc0-map/claude-config", "api-key")).toEqual({ ...isolated, ANTHROPIC_API_KEY: "sk-ant-x" });
    expect(armEnv(parent, "/w/fd-doc0-map/claude-config", "subscription")).toEqual({ ...isolated, CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-x" });
  });
});

describe("secrets", () => {
  const env = {
    ANTHROPIC_API_KEY: "sk-ant-api03-secret", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-secret", GEMINI_API_KEY: "AIza-judge-key",
    GITHUB_TOKEN: "ghp_123456789", PATH: "/usr/bin", SHORT_KEY: "abc",
  };

  it("secretValues takes the secret-looking variables of 8 characters or more", () => {
    expect(secretValues(env)).toEqual([
      ["ANTHROPIC_API_KEY", "sk-ant-api03-secret"], ["CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat01-secret"],
      ["GEMINI_API_KEY", "AIza-judge-key"], ["GITHUB_TOKEN", "ghp_123456789"],
    ]);
  });

  it("redactSecrets replaces every value and names each variable found", () => {
    const text = 'env: ANTHROPIC_API_KEY=sk-ant-api03-secret\n{"k":"AIza-judge-key","again":"sk-ant-api03-secret"}';
    expect(redactSecrets(text, secretValues(env))).toEqual({
      text: 'env: ANTHROPIC_API_KEY=[REDACTED ANTHROPIC_API_KEY]\n{"k":"[REDACTED GEMINI_API_KEY]","again":"[REDACTED ANTHROPIC_API_KEY]"}',
      found: ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"],
    });
    expect(redactSecrets("Bearer sk-ant-oat01-secret", secretValues(env))).toEqual({
      text: "Bearer [REDACTED CLAUDE_CODE_OAUTH_TOKEN]", found: ["CLAUDE_CODE_OAUTH_TOKEN"],
    });
    expect(redactSecrets("clean", secretValues(env))).toEqual({ text: "clean", found: [] });
  });
});
