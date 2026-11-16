import { describe, it, expect, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadArmCorpus } from "./arm-corpus.ts";

const dirs: string[] = [];
async function corpusDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const meta = (system: "doc0" | "openwiki") => ({ schema_version: 4, system, arm: system === "doc0" ? "doc0-map" : "openwiki", status: "complete" });

// The doc0-write skill's "Example page" (doc0-commercial packages/cli/skill/doc0-write/SKILL.md at 894b32f9a): it follows
// the skill's rule of a Sources line after every block, a diagram and a table included.
const SKILL_EXAMPLE_PAGE = `---
title: "Request Handling"
---
## Overview

The server turns each HTTP request into one handler call. \`createServer\` builds the router once at start and passes every request to \`route\`, which picks the handler by method and path.

Sources: [src/server.ts:1-24](repo://src/server.ts#L1-L24)

A request that matches no route answers 404 before any middleware runs, so a mistyped path never reaches authentication. [[Configuration]] sets the port and the routes file.

Sources: [src/router.ts:10-32](repo://src/router.ts#L10-L32)

## Dispatch

\`route\` tries the exact path first, then the patterns in registration order: the first pattern registered wins a tie.

Sources: [src/router.ts:34-48](repo://src/router.ts#L34-L48)

\`\`\`mermaid
flowchart LR
  req["Incoming request"] --> route["route()"]
  route -->|match| handler["Handler"]
  route -->|no match| notFound["404"]
\`\`\`

Sources: [src/router.ts:10-48](repo://src/router.ts#L10-L48)

| Method | Path | Handler |
| --- | --- | --- |
| GET | \`/health\` | \`healthCheck\` |
| POST | \`/items\` | \`createItem\` |

Sources: [src/routes.ts:3-12](repo://src/routes.ts#L3-L12)
`;

describe("loadArmCorpus", () => {
  it("refuses a meta an older harness wrote: it lacks the credential the report checks", async () => {
    const dir = await corpusDir("arm-old-");
    await writeFile(join(dir, "_meta.json"), JSON.stringify({ ...meta("doc0"), schema_version: 3 }));
    await expect(loadArmCorpus(dir)).rejects.toThrow("_meta.json has schema_version 3, not 4: run the arm again.");
  });

  it("a doc0 arm's repo:// Sources line yields its claim group", async () => {
    const dir = await corpusDir("arm-doc0-");
    await writeFile(join(dir, "_meta.json"), JSON.stringify(meta("doc0")));
    await writeFile(
      join(dir, "walk.md"),
      '---\ntitle: "Walking the tree"\n---\n## Overview\n\nThe walker spawns one thread per CPU core.\n\nSources: [src/walk.rs:10-40](repo://src/walk.rs#L10-L40), [build.rs:1-5](repo://build.rs#L1-L5)\n',
    );
    const corpus = await loadArmCorpus(dir);
    expect(corpus.meta.system).toBe("doc0");
    expect(corpus.pages).toEqual([
      { slug: "walk.md", title: "Walking the tree", content: expect.stringMatching(/^## Overview/) as unknown, verifiedClaimRatio: null },
    ]);
    expect(corpus.claimGroups).toEqual([
      {
        claim: "The walker spawns one thread per CPU core.",
        citations: [
          { filePath: "src/walk.rs", startLine: 10, endLine: 40 },
          { filePath: "build.rs", startLine: 1, endLine: 5 },
        ],
      },
    ]);
  });

  it("a doc0 group whose claim is a diagram edge or a table row is not a claim: the skill's example page keeps 3 of its 5", async () => {
    const dir = await corpusDir("arm-doc0-");
    await writeFile(join(dir, "_meta.json"), JSON.stringify(meta("doc0")));
    await writeFile(join(dir, "request-handling.md"), SKILL_EXAMPLE_PAGE);
    const corpus = await loadArmCorpus(dir);
    expect(corpus.claimGroups.map((g) => g.claim)).toEqual([
      expect.stringMatching(/^The server turns each HTTP request/),
      expect.stringMatching(/^A request that matches no route answers 404/),
      expect.stringMatching(/^`route` tries the exact path first/),
    ]);
  });

  it("an openwiki arm's pages lose their front matter and its groups come from _claims", async () => {
    const dir = await corpusDir("arm-ow-");
    await writeFile(join(dir, "_meta.json"), JSON.stringify(meta("openwiki")));
    await mkdir(join(dir, "architecture"));
    await writeFile(join(dir, "architecture", "walk.md"), "---\ntype: architecture\ntitle: 'Walk: the tree'\nsources:\n  - resource: repo://src/walk.rs\n---\n# Walk\n\nBody [src/walk.rs:1-2](repo://src/walk.rs#L1-L2).\n");
    await mkdir(join(dir, "_claims", "architecture"), { recursive: true });
    await writeFile(join(dir, "_claims", "architecture", "walk.json"), JSON.stringify({
      schemaVersion: 1, claims: [{ id: "c1", statement: "Walk claim.", evidence: [{ resource: "repo://src/walk.rs#L1-L9", version: "v" }] }],
    }));
    const corpus = await loadArmCorpus(dir);
    expect(corpus.pages.map((p) => [p.slug, p.title])).toEqual([["architecture/walk.md", "Walk: the tree"]]);
    expect(corpus.pages[0]?.content.startsWith("# Walk")).toBe(true);
    expect(corpus.claimGroups).toEqual([{ claim: "Walk claim.", citations: [{ filePath: "src/walk.rs", startLine: 1, endLine: 9 }] }]);
  });

  it("the same filter drops an openwiki Claim that is a code line, a diagram edge or a table row", async () => {
    const dir = await corpusDir("arm-ow-");
    await writeFile(join(dir, "_meta.json"), JSON.stringify(meta("openwiki")));
    await writeFile(join(dir, "walk.md"), "---\ntitle: Walk\n---\n# Walk\n\n```rust\nlet walker = WalkBuilder::new(path).threads(n).build_parallel();\n```\n");
    await mkdir(join(dir, "_claims"));
    const evidence = [{ resource: "repo://src/walk.rs#L1-L9", version: "v" }];
    const statements = [
      "The walker runs one thread per CPU core.",
      "let walker = WalkBuilder::new(path).threads(n).build_parallel();",
      'route -->|no match| notFound["404"]',
      "| POST | `/items` | `createItem` |",
      "```rust",
    ];
    await writeFile(join(dir, "_claims", "walk.json"), JSON.stringify({ schemaVersion: 1, claims: statements.map((statement, i) => ({ id: `c${i}`, statement, evidence })) }));
    const corpus = await loadArmCorpus(dir);
    expect(corpus.claimGroups.map((g) => g.claim)).toEqual(["The walker runs one thread per CPU core."]);
  });
});

describe("loadArmCorpus: each wiki in its own navigation order", () => {
  const page = (title: string) => `---\ntitle: "${title}"\n---\n## Overview\n\n${title} body.\n`;

  it("orders a doc0 corpus by navigation.json: sections in order, then root pages, then unlisted pages by path", async () => {
    const dir = await corpusDir("arm-nav-");
    await writeFile(join(dir, "_meta.json"), JSON.stringify(meta("doc0")));
    for (const slug of ["api", "cli", "overview", "quickstart", "stray", "testing"]) await writeFile(join(dir, `${slug}.md`), page(slug));
    await writeFile(join(dir, "navigation.json"), JSON.stringify({
      sections: [
        { slug: "getting-started", title: "Getting Started", pages: ["overview", "quickstart"] },
        { slug: "reference", title: "Reference", pages: ["cli", "gone"] },
      ],
      pages: ["testing", "api"],
    }));
    const corpus = await loadArmCorpus(dir);
    expect(corpus.pages.map((p) => [p.slug, p.section])).toEqual([
      ["overview.md", "Getting Started"], ["quickstart.md", "Getting Started"], ["cli.md", "Reference"],
      ["testing.md", undefined], ["api.md", undefined], ["stray.md", undefined],
    ]);
  });

  it("orders an openwiki corpus by its index.md files, which are never pages: each level's files, then its folders", async () => {
    const dir = await corpusDir("arm-ow-nav-");
    await writeFile(join(dir, "_meta.json"), JSON.stringify(meta("openwiki")));
    const ow = (title: string) => `---\ntitle: ${title}\n---\n# ${title}\n\nBody.\n`;
    for (const folder of ["architecture", "concepts", "_claims"]) await mkdir(join(dir, folder));
    await writeFile(join(dir, "quickstart.md"), ow("Quickstart"));
    await writeFile(join(dir, "architecture", "overview.md"), ow("Overview"));
    await writeFile(join(dir, "architecture", "lifecycle.md"), ow("Lifecycle"));
    await writeFile(join(dir, "concepts", "types.md"), ow("Types"));
    await writeFile(join(dir, "concepts", "unlisted.md"), ow("Unlisted"));
    await writeFile(join(dir, "index.md"), "---\nokf_version: \"0.2\"\n---\n\n# Files\n\n- [Quickstart](quickstart.md) - Start.\n\n# Directories\n\n- [concepts](concepts/)\n- [architecture](architecture/)\n");
    await writeFile(join(dir, "architecture", "index.md"), "\n# Files\n\n- [Overview](overview.md) - Map.\n- [Lifecycle](lifecycle.md) - Flow.\n");
    await writeFile(join(dir, "concepts", "index.md"), "\n# Files\n\n- [Types](types.md) - Types.\n");
    const corpus = await loadArmCorpus(dir);
    expect(corpus.pages.map((p) => [p.slug, p.section])).toEqual([
      ["quickstart.md", undefined], ["concepts/types.md", "concepts"], ["architecture/overview.md", "architecture"],
      ["architecture/lifecycle.md", "architecture"], ["concepts/unlisted.md", undefined],
    ]);
  });

  it("keeps path order when the corpus holds no navigation (a corpus made before the harness kept it)", async () => {
    const dir = await corpusDir("arm-no-nav-");
    await writeFile(join(dir, "_meta.json"), JSON.stringify(meta("doc0")));
    for (const slug of ["b", "a"]) await writeFile(join(dir, `${slug}.md`), page(slug));
    expect((await loadArmCorpus(dir)).pages.map((p) => p.slug)).toEqual(["a.md", "b.md"]);
  });
});
