// The three generation arms: the same Claude model writes a repository's docs
// with the openwiki skill, or with doc0's skill with or without the map.
// Everything an arm differs by lives in ARM_TOOLS; the rest is identical by
// construction (prompt, flags, budget, time cap, isolation).

import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ArmCredential, ArmName } from "../../scoring/arm-corpus.ts";

export const ARMS = ["openwiki", "doc0-map", "doc0-nomap"] as const satisfies readonly ArmName[];

/** The source SHAs the 2026-07 cloud corpora pin, so the arms read beside doc0's cloud pages and the peers. */
export const ARM_REPOS = {
  hono: { repo: "honojs/hono", sha: "b2ae3a2204a48ce15a26448fd746d39745eb1837" },
  fd: { repo: "sharkdp/fd", sha: "41532d114e2ba565fb5367d606c111b29b96450c" },
  celery: { repo: "celery/celery", sha: "1432d9b6c6868a77e7ee2ede1650da00a8d187ac" },
} as const;
export type RepoName = keyof typeof ARM_REPOS;
export const REPOS = Object.keys(ARM_REPOS) as RepoName[];

/** Page counts of each repository's cloud corpus: the size a full run is capped for. */
export const CLOUD_PAGE_COUNTS: Record<RepoName, number> = { hono: 29, fd: 23, celery: 45 };

/** ceil(1.5 × m × pages) + 15: 1.5 the margin, 15 minutes for begin, the map and the plan. */
export function capMinutes(minutesPerPage: number, pages: number): number {
  return Math.ceil(1.5 * minutesPerPage * pages) + 15;
}

/** Provisional: the dry run (Task 4) replaces it with the largest measured minutes per page among its three arms. */
export const MINUTES_PER_PAGE = 4;
export const ARM_TIME_CAPS = Object.fromEntries(
  REPOS.map((repo) => [repo, capMinutes(MINUTES_PER_PAGE, CLOUD_PAGE_COUNTS[repo])]),
) as Record<RepoName, number>;
export const DRY_RUN_TIME_CAP = 60;

const ARM_TOOLS: Record<ArmName, { system: "doc0" | "openwiki"; skill: string; server: string; finish: string }> = {
  openwiki: { system: "openwiki", skill: "openwiki", server: "openwiki", finish: "openwiki_finish" },
  "doc0-map": { system: "doc0", skill: "doc0-write", server: "doc0-local", finish: "doc0_finish" },
  "doc0-nomap": { system: "doc0", skill: "doc0-write", server: "doc0-local", finish: "doc0_finish" },
};
export const armSystem = (arm: ArmName) => ARM_TOOLS[arm].system;
/** The finish tool whose result proves a run complete, named as Claude Code calls it. */
export const armFinishTool = (arm: ArmName) => `mcp__${ARM_TOOLS[arm].server}__${ARM_TOOLS[arm].finish}`;

export interface ArmTools { doc0Cli: string; doc0Skill: string; openwikiBin: string }

/** Folders of one arm's run on one repository: nothing is shared between arms or repositories. */
export function armDirs(workDir: string, repo: RepoName, arm: ArmName) {
  const root = join(workDir, `${repo}-${arm}`);
  return { root, clone: join(root, "src"), config: join(root, "claude-config") };
}

/**
 * Installs one arm into its clone: the arm's skill under `.claude/skills/`,
 * and an MCP file beside the clone (never inside it) that names the arm's
 * server alone.
 */
export async function armSetup(arm: ArmName, clone: string, tools: ArmTools): Promise<{ mcpConfigFile: string; skillName: string }> {
  const { skill, server } = ARM_TOOLS[arm];
  let entry: { command: string; args: string[] };
  if (ARM_TOOLS[arm].system === "doc0") {
    const skillDir = join(clone, ".claude", "skills", skill);
    await mkdir(skillDir, { recursive: true });
    await copyFile(tools.doc0Skill, join(skillDir, "SKILL.md"));
    entry = { command: tools.doc0Cli, args: ["mcp", "--no-publish", ...(arm === "doc0-nomap" ? ["--no-map"] : [])] };
  } else {
    execFileSync(tools.openwikiBin, ["integrations", "install", "claude", "--project", "."], { cwd: clone, stdio: "inherit" });
    entry = { command: tools.openwikiBin, args: ["mcp", "--host", "claude"] };
  }
  const mcpConfigFile = join(dirname(clone), "mcp.json");
  await writeFile(mcpConfigFile, `${JSON.stringify({ mcpServers: { [server]: entry } }, null, 2)}\n`);
  return { mcpConfigFile, skillName: skill };
}

/** The one prompt every arm gets; only the skill's name differs. */
export function armPrompt(arm: ArmName, { maxPages }: { maxPages?: number }): string {
  const prompt =
    `Create the documentation for this repository with the ${ARM_TOOLS[arm].skill} skill: start a new run in init mode and finish it. ` +
    "Do not ask questions; work until the finish step reports complete.";
  return maxPages === undefined ? prompt : `${prompt} Plan at most ${maxPages} pages.`;
}

/**
 * Headless Claude Code flags. stream-json (which needs --verbose) ends with
 * the same `result` object as --output-format json, and starts with the init
 * event that lists the skills and MCP servers the run saw: the transcript
 * that proves isolation.
 */
export function claudeArgs(a: { prompt: string; mcpConfigFile: string; model: string; effort: string; budgetUsd: number }): string[] {
  return [
    "-p", a.prompt,
    "--output-format", "stream-json", "--verbose",
    "--model", a.model,
    "--effort", a.effort,
    "--mcp-config", a.mcpConfigFile,
    "--strict-mcp-config",
    "--setting-sources", "project",
    "--max-budget-usd", String(a.budgetUsd),
    "--dangerously-skip-permissions",
    "--no-session-persistence",
  ];
}

/** Why the run's init event shows a setup other than the arm's own, or null when it shows only the arm's. */
export function isolationProblem(arm: ArmName, events: unknown[]): string | null {
  const init = events.find((e): e is { mcp_servers?: { name: string; status?: string }[]; skills?: string[]; plugins?: { name: string }[] } =>
    typeof e === "object" && e !== null && "type" in e && e.type === "system" && "subtype" in e && e.subtype === "init");
  if (init === undefined) return "no init event in the transcript";
  const { skill, server } = ARM_TOOLS[arm];
  const servers = (init.mcp_servers ?? []).map((s) => s.name);
  if (servers.length !== 1 || servers[0] !== server) return `MCP servers ${JSON.stringify(servers)}, expected only ${server}`;
  const status = init.mcp_servers?.[0]?.status;
  if (status !== "connected") return `MCP server ${server} is ${String(status)}, not connected`;
  const plugins = (init.plugins ?? []).map((p) => p.name);
  if (plugins.length > 0) return `plugins loaded: ${plugins.join(", ")}`;
  const skills = init.skills ?? [];
  if (!skills.includes(skill)) return `the ${skill} skill is missing (skills: ${skills.join(", ")})`;
  const others = Object.values(ARM_TOOLS).map((t) => t.skill).filter((s) => s !== skill && skills.includes(s));
  if (others.length > 0) return `another arm's skill is present: ${others.join(", ")}`;
  return null;
}

/** The variable each credential is read from: an API key, or a `claude setup-token` subscription token. */
const CREDENTIAL_VARS: Record<ArmCredential, string> = { "api-key": "ANTHROPIC_API_KEY", subscription: "CLAUDE_CODE_OAUTH_TOKEN" };

/** The one credential the launching shell holds; throws when it holds both (the arms could differ) or neither. */
export function armCredential(env: NodeJS.ProcessEnv): ArmCredential {
  const set = (Object.keys(CREDENTIAL_VARS) as ArmCredential[]).filter((kind) => env[CREDENTIAL_VARS[kind]]);
  if (set.length === 2) throw new Error("both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set: set exactly one, so every arm runs on the same credential.");
  if (set.length === 0) throw new Error("neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set: each run's config folder starts empty, with no login.");
  return set[0];
}

/** The launching shell's variables an arm may see besides its credential; everything else (CLAUDE_CODE_*, judge keys, proxies) stays out. */
const ENV_ALLOWLIST = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR"] as const;

/** The environment of an arm's claude and of every tool and server it starts: the allowlist and the run's credential, with HOME and the config in the run's own folder. */
export function armEnv(parent: NodeJS.ProcessEnv, configDir: string, credential: ArmCredential): NodeJS.ProcessEnv {
  const kept = [...ENV_ALLOWLIST, CREDENTIAL_VARS[credential]].flatMap((name) => (parent[name] === undefined ? [] : [[name, parent[name]]]));
  return { ...Object.fromEntries(kept), HOME: configDir, CLAUDE_CONFIG_DIR: configDir };
}

/** The launching environment's secret-looking variables (8 characters or more), as [name, value]. */
export function secretValues(env: NodeJS.ProcessEnv): Array<[string, string]> {
  return Object.entries(env).flatMap(([name, value]) =>
    value !== undefined && value.length >= 8 && /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE/i.test(name) ? [[name, value]] : []);
}

/** `text` with every secret value replaced by its variable's name, and the names found. */
export function redactSecrets(text: string, secrets: Array<[string, string]>): { text: string; found: string[] } {
  const found = secrets.filter(([, value]) => text.includes(value)).map(([name]) => name);
  return { text: secrets.reduce((t, [name, value]) => t.replaceAll(value, `[REDACTED ${name}]`), text), found };
}

/**
 * Why DOC0_CLI cannot run an arm, or null. The workspace build under
 * packages/cli/dist loads TypeScript sources, so only a packed install
 * (install-packed.sh) runs the CLI as users get it.
 */
export async function usableDoc0Cli(path: string | undefined): Promise<string | null> {
  if (!path) return "DOC0_CLI is not set: point it at the binary install-packed.sh prints.";
  try {
    if (!(await stat(path)).isFile()) throw new Error("not a file");
    await access(path, constants.X_OK);
  } catch {
    return `DOC0_CLI (${path}) is not an executable file.`;
  }
  if ([path, await realpath(path)].some((p) => p.includes("packages/cli/dist"))) {
    return `DOC0_CLI (${path}) is the workspace build under packages/cli/dist: use the binary install-packed.sh prints.`;
  }
  return null;
}
