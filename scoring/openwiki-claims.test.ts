import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOpenwikiClaimGroups } from "./openwiki-claims.ts";

async function sidecars(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ow-claims-"));
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), JSON.stringify(body));
  }
  return dir;
}

const claim = (statement: string, ...resources: string[]) => ({
  id: statement.slice(0, 8), statement, evidence: resources.map((resource) => ({ resource, version: "sha256:x" })),
});

describe("loadOpenwikiClaimGroups", () => {
  it("an openwiki claim with two ranged resources is one group with two citations", async () => {
    const dir = await sidecars({
      "architecture/walk.json": { schemaVersion: 1, claims: [claim("The walker runs one thread per CPU.", "repo://src/walk.rs#L10-L40", "repo://src/main.rs#L5")] },
    });
    expect(loadOpenwikiClaimGroups(dir)).toEqual([
      {
        claim: "The walker runs one thread per CPU.",
        citations: [
          { filePath: "src/walk.rs", startLine: 10, endLine: 40 },
          { filePath: "src/main.rs", startLine: 5, endLine: 5 },
        ],
      },
    ]);
    await rm(dir, { recursive: true });
  });

  it("a whole-file resource becomes a citation resolveCitation refuses (line 0)", async () => {
    const dir = await sidecars({ "quickstart.json": { schemaVersion: 1, claims: [claim("fd is configured by flags.", "repo://src/cli.rs")] } });
    expect(loadOpenwikiClaimGroups(dir)).toEqual([{ claim: "fd is configured by flags.", citations: [{ filePath: "src/cli.rs", startLine: 0, endLine: 0 }] }]);
    await rm(dir, { recursive: true });
  });

  it("reads every sidecar, nested ones included, in path order", async () => {
    const dir = await sidecars({
      "b.json": { schemaVersion: 1, claims: [claim("Second page claim.", "repo://b.rs#L1-L2")] },
      "a/deep.json": { schemaVersion: 1, claims: [claim("First page claim.", "repo://a.rs#L1-L2"), claim("Another claim here.", "repo://a.rs#L3-L4")] },
    });
    expect(loadOpenwikiClaimGroups(dir).map((g) => g.claim)).toEqual(["First page claim.", "Another claim here.", "Second page claim."]);
    await rm(dir, { recursive: true });
  });

  it("no _claims folder means no groups", () => {
    expect(loadOpenwikiClaimGroups(join(tmpdir(), "no-such-claims-dir"))).toEqual([]);
  });
});
