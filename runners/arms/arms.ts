// The three generation arms: the same model writes a repository's docs with
// the openwiki skill, or with doc0's skill with or without the map, under
// Claude Code or the Codex CLI (the host). Everything an arm differs by lives
// in ARM_TOOLS; the rest is identical by construction (prompt, flags, caps,
// isolation).

import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ArmCredential, ArmHost, ArmName } from "../../scoring/arm-corpus.ts";

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

/**
 * The seven repositories with published CodeWikiBench scores, at the commits of
 * the dataset's rows (anhnh2002/codewikibench @ 6d215eb7), keyed by its repo_name.
 * bench:arm runs them; the arms report and its decision rules read REPOS alone.
 */
export const CODEWIKIBENCH_REPOS = {
  OpenHands: { repo: "All-Hands-AI/OpenHands", sha: "30604c40fc6e9ac914089376f41e118582954f22" },
  svelte: { repo: "sveltejs/svelte", sha: "be645b4d9f84cb7580683c7b2336d1023906c4da" },
  puppeteer: { repo: "puppeteer/puppeteer", sha: "c1105f125c71353587a837958c2748097ef2927d" },
  "ml-agents": { repo: "Unity-Technologies/ml-agents", sha: "4cf2f49ad0a973c95eb41325aa3a46959f187708" },
  logstash: { repo: "elastic/logstash", sha: "895cfa5b14633ae9b9e671105f7b7935c9f2b9f1" },
  wazuh: { repo: "wazuh/wazuh", sha: "44b7cd33e05abb7730228bb092b23b419ee4f15e" },
  electron: { repo: "electron/electron", sha: "828fd59a72e673acf03f878b4f488a40fca46dfe" },
} as const;

/**
 * Pages a run on each is expected to write: hono's 29 scaled by the square root
 * of tracked source files outside tests, fixtures, examples and docs (hono 203),
 * held to 25–45. Counts at the dataset commits: puppeteer 257, ml-agents 348,
 * svelte 421, logstash 739, electron 1,028, OpenHands 1,282, wazuh 2,314.
 */
const CODEWIKIBENCH_PAGE_ESTIMATES: Record<keyof typeof CODEWIKIBENCH_REPOS, number> = {
  OpenHands: 45, svelte: 42, puppeteer: 33, "ml-agents": 38, logstash: 45, wazuh: 45, electron: 45,
};

/** Every repository bench:arm runs. */
export const RUN_REPOS = { ...ARM_REPOS, ...CODEWIKIBENCH_REPOS };
export type RunRepoName = keyof typeof RUN_REPOS;

/** m: the largest minutes per page among the 2026-11-15 dry run's three arms (openwiki, 215,537 ms over 3 pages on fd). */
export const MINUTES_PER_PAGE = 1.2;
const EXPECTED_PAGES: Record<RunRepoName, number> = { ...CLOUD_PAGE_COUNTS, ...CODEWIKIBENCH_PAGE_ESTIMATES };
export const ARM_TIME_CAPS = Object.fromEntries(
  Object.entries(EXPECTED_PAGES).map(([repo, pages]) => [repo, capMinutes(MINUTES_PER_PAGE, pages)]),
) as Record<RunRepoName, number>;
export const DRY_RUN_TIME_CAP = 60;

const ARM_TOOLS: Record<ArmName, { system: "doc0" | "openwiki"; skill: string; server: string; finish: string }> = {
  openwiki: { system: "openwiki", skill: "openwiki", server: "openwiki", finish: "openwiki_finish" },
  "doc0-map": { system: "doc0", skill: "doc0-write", server: "doc0-local", finish: "doc0_finish" },
  "doc0-nomap": { system: "doc0", skill: "doc0-write", server: "doc0-local", finish: "doc0_finish" },
};
export const armSystem = (arm: ArmName) => ARM_TOOLS[arm].system;
/** The arm's one MCP server and the finish tool whose result proves a run complete, as the server names it. */
export const armServer = (arm: ArmName) => ({ server: ARM_TOOLS[arm].server, finish: ARM_TOOLS[arm].finish });
/** The finish tool, named as Claude Code calls it. */
export const armFinishTool = (arm: ArmName) => `mcp__${ARM_TOOLS[arm].server}__${ARM_TOOLS[arm].finish}`;

export interface ArmTools { doc0Cli: string; doc0Skill: string; openwikiBin: string }

/** Folders of one arm's run on one repository: nothing is shared between arms or repositories. */
export function armDirs(workDir: string, repo: RunRepoName, arm: ArmName, host: ArmHost) {
  const root = join(workDir, `${repo}-${arm}`);
  return { root, clone: join(root, "src"), config: join(root, `${host}-config`) };
}

/** Where each host reads a repository's skills. */
const SKILL_DIRS: Record<ArmHost, string> = { claude: ".claude/skills", codex: ".agents/skills" };

export interface McpEntry { command: string; args: string[] }

/**
 * Installs one arm into its clone for its host: the arm's skill where the
 * host reads a repository's skills (openwiki through its own installer), and
 * the command of the arm's one MCP server, which the run's config names
 * (never a file in the clone).
 */
export async function armSetup(arm: ArmName, clone: string, tools: ArmTools, host: ArmHost): Promise<{ server: string; entry: McpEntry }> {
  const { skill, server } = ARM_TOOLS[arm];
  if (ARM_TOOLS[arm].system === "doc0") {
    const skillDir = join(clone, SKILL_DIRS[host], skill);
    await mkdir(skillDir, { recursive: true });
    await copyFile(tools.doc0Skill, join(skillDir, "SKILL.md"));
    return { server, entry: { command: tools.doc0Cli, args: ["mcp", "--no-publish", ...(arm === "doc0-nomap" ? ["--no-map"] : [])] } };
  }
  execFileSync(tools.openwikiBin, ["integrations", "install", host, "--project", "."], { cwd: clone, stdio: "inherit" });
  // codex trusts the folder it runs in and would layer this project block (a bare `openwiki` on PATH) over the run's own.
  if (host === "codex") await rm(join(clone, ".codex"), { recursive: true, force: true });
  return { server, entry: { command: tools.openwikiBin, args: ["mcp", "--host", host] } };
}

/** Claude Code's MCP file, beside the clone (never inside it), naming the arm's server alone. */
export async function writeClaudeMcpConfig(clone: string, server: string, entry: McpEntry): Promise<string> {
  const mcpConfigFile = join(dirname(clone), "mcp.json");
  await writeFile(mcpConfigFile, `${JSON.stringify({ mcpServers: { [server]: entry } }, null, 2)}\n`);
  return mcpConfigFile;
}

/**
 * The whole config.toml of a codex run's own CODEX_HOME: the model and effort,
 * no approval prompts with commands sandboxed to the clone (workspace-write),
 * the arm's MCP server alone with its tools approved, and off everything a
 * ChatGPT sign-in brings beside it: its connectors (apps), plugins and the
 * skills bundled with codex. TOML basic strings and arrays read JSON's.
 */
export function codexConfigToml(a: { server: string; entry: McpEntry; model: string; effort: string }): string {
  return [
    `model = ${JSON.stringify(a.model)}`,
    `model_reasoning_effort = ${JSON.stringify(a.effort)}`,
    `approval_policy = "never"`,
    `sandbox_mode = "workspace-write"`,
    "",
    "[features]",
    "apps = false",
    "plugins = false",
    "",
    "[skills.bundled]",
    "enabled = false",
    "",
    `[mcp_servers.${JSON.stringify(a.server)}]`,
    `command = ${JSON.stringify(a.entry.command)}`,
    `args = ${JSON.stringify(a.entry.args)}`,
    `default_tools_approval_mode = "approve"`,
    "",
  ].join("\n");
}

/** `codex exec` flags: JSONL events on stdout, no session files, and a config key codex does not know fails the run. */
export function codexArgs(prompt: string): string[] {
  return ["exec", "--json", "--ephemeral", "--strict-config", prompt];
}

/** The `codex debug prompt-input` call that renders what the model would see for the prompt, run before the arm with its config. */
export function codexPromptInputArgs(prompt: string): string[] {
  return ["debug", "prompt-input", prompt];
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

/** Why the run's init event (claude) shows a setup other than the arm's own, or null when it shows only the arm's. */
export function isolationProblem(arm: ArmName, events: unknown[]): string | null {
  const init = events.find((e): e is { mcp_servers?: { name: string; status?: string }[]; skills?: string[]; plugins?: { name: string; path?: string; source?: string }[] } =>
    typeof e === "object" && e !== null && "type" in e && e.type === "system" && "subtype" in e && e.subtype === "init");
  if (init === undefined) return "no init event in the transcript";
  const { skill, server } = ARM_TOOLS[arm];
  const servers = (init.mcp_servers ?? []).map((s) => s.name);
  if (servers.length !== 1 || servers[0] !== server) return `MCP servers ${JSON.stringify(servers)}, expected only ${server}`;
  const status = init.mcp_servers?.[0]?.status;
  if (status !== "connected") return `MCP server ${server} is ${String(status)}, not connected`;
  // Claude Code ships some plugins inside itself (path "builtin"): every arm gets the same ones, none comes from a user.
  const plugins = (init.plugins ?? []).filter((p) => p.path !== "builtin" || p.source !== `${p.name}@builtin`).map((p) => p.name);
  if (plugins.length > 0) return `plugins loaded: ${plugins.join(", ")}`;
  const skills = init.skills ?? [];
  if (!skills.includes(skill)) return `the ${skill} skill is missing (skills: ${skills.join(", ")})`;
  const others = Object.values(ARM_TOOLS).map((t) => t.skill).filter((s) => s !== skill && skills.includes(s));
  if (others.length > 0) return `another arm's skill is present: ${others.join(", ")}`;
  return null;
}

interface PromptItem { type?: string; name?: string; tools?: PromptItem[]; content?: Array<{ text?: string }> }

/** A server's name as codex writes it in tool names (`doc0-local` → `doc0_local`). */
const codexToolName = (server: string) => server.replace(/[^A-Za-z0-9_]/g, "_");

/**
 * Why the prompt codex would send (`codex debug prompt-input`) shows a setup
 * other than the arm's own, or null. Codex has no init event: its prompt
 * lists the skills it may use and the MCP servers it reached (deferred
 * namespaces `mcp__<server>`, or tools of that name; a server that failed to
 * start is absent), so it is the proof.
 */
export function codexIsolationProblem(arm: ArmName, promptInput: unknown): string | null {
  if (!Array.isArray(promptInput)) return "codex rendered no prompt input";
  const items = promptInput as PromptItem[];
  const text = items.flatMap((i) => i.content ?? []).map((c) => c.text ?? "").join("\n");
  const toolNames = (list: PromptItem[]): string[] => list.flatMap((t) => [t.name ?? "", ...toolNames(t.tools ?? [])]);
  const servers = new Set([
    ...[...text.matchAll(/^- mcp__([\w-]+)(?::.*)?$/gm)].map((m) => m[1]),
    ...toolNames(items.flatMap((i) => i.tools ?? [])).flatMap((n) => /^mcp__([\w-]+?)(?:__|$)/.exec(n)?.[1] ?? []),
  ]);
  const { skill, server } = ARM_TOOLS[arm];
  if (servers.size !== 1 || !servers.has(codexToolName(server))) return `MCP servers ${JSON.stringify([...servers])}, expected only ${server}`;
  const skills = [...(/<skills_instructions>([\s\S]*?)<\/skills_instructions>/.exec(text)?.[1] ?? "").matchAll(/^- ([\w-]+): .*\(file: /gm)].map((m) => m[1]);
  if (skills.length !== 1 || skills[0] !== skill) return `skills ${JSON.stringify(skills)}, expected only ${skill}`;
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

/** The launching shell's variables an arm may see besides claude's credential; everything else (CLAUDE_CODE_*, OPENAI_*, judge keys, proxies) stays out. */
const ENV_ALLOWLIST = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR"] as const;

/**
 * The environment of an arm's agent and of every tool and server it starts:
 * the allowlist, with HOME and the host's config in the run's own folder.
 * claude also gets the run's credential; codex signs in from the auth file
 * copied into that folder.
 */
export function armEnv(parent: NodeJS.ProcessEnv, configDir: string, host: ArmHost, credential: ArmCredential): NodeJS.ProcessEnv {
  const names = host === "claude" ? [...ENV_ALLOWLIST, CREDENTIAL_VARS[credential]] : ENV_ALLOWLIST;
  const kept = names.flatMap((name) => (parent[name] === undefined ? [] : [[name, parent[name]]]));
  return { ...Object.fromEntries(kept), HOME: configDir, ...(host === "claude" ? { CLAUDE_CONFIG_DIR: configDir } : { CODEX_HOME: configDir }) };
}

const secretEntries = (pairs: Array<[string, unknown]>): Array<[string, string]> =>
  pairs.flatMap(([name, value]) => (typeof value === "string" && value.length >= 8 && /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE/i.test(name) ? [[name, value]] : []));

/** The launching environment's secret-looking variables (8 characters or more), as [name, value]. */
export function secretValues(env: NodeJS.ProcessEnv): Array<[string, string]> {
  return secretEntries(Object.entries(env));
}

/** A JSON credential file's secret-looking values (codex's auth.json tokens), named `<label> <path>`, as secretValues names variables. */
export function jsonSecrets(label: string, json: unknown): Array<[string, string]> {
  const leaves = (value: unknown, path: string): Array<[string, unknown]> =>
    typeof value === "object" && value !== null ? Object.entries(value).flatMap(([k, v]) => leaves(v, path === "" ? k : `${path}.${k}`)) : [[path, value]];
  return secretEntries(leaves(json, "")).map(([path, value]) => [`${label} ${path}`, value]);
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
