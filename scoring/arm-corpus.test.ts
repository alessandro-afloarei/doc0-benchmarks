import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadArmCorpus } from "./arm-corpus.ts";

describe("loadArmCorpus", () => {
  const meta = (system: "doc0" | "openwiki") => ({ schema_version: 2, system, arm: system === "doc0" ? "doc0-map" : "openwiki", status: "complete" });

  it("a doc0 arm's repo:// Sources line yields its claim group", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arm-doc0-"));
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

  it("an openwiki arm's pages lose their front matter and its groups come from _claims", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arm-ow-"));
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
});
