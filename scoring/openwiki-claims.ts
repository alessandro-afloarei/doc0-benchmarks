// openwiki keeps its line-ranged evidence out of the page body: each page's
// Claims live in openwiki/.claims/<page>.json (`statement`, `evidence[].resource`
// such as repo://src/agent/index.ts#L167-L290). Those Claims are its grounded
// statements, so they are its claim population.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaimGroup } from "./judge-accuracy.ts";

interface Sidecar { claims: Array<{ statement: string; evidence: Array<{ resource: string }> }> }

/**
 * repo://<path>#L<a>-L<b> as a citation. Evidence without a line range (a
 * whole file) gets line 0, which resolveCitation refuses: it stays an
 * unresolved group in the denominator, never leaves it.
 */
function evidenceCitation(resource: string): ClaimGroup["citations"][number] {
  const [path, fragment = ""] = resource.replace(/^repo:\/\//, "").split("#");
  const range = /^L(\d+)(?:-L?(\d+))?$/.exec(fragment);
  const startLine = range ? Number(range[1]) : 0;
  return { filePath: path, startLine, endLine: range?.[2] ? Number(range[2]) : startLine };
}

/** One group per Claim, every sidecar under `claimsDir` in path order. A folder that cannot be read throws. */
export function loadOpenwikiClaimGroups(claimsDir: string): ClaimGroup[] {
  const files = readdirSync(claimsDir, { recursive: true, encoding: "utf-8" }).filter((f) => f.endsWith(".json")).sort();
  return files.flatMap((file) => {
    const sidecar = JSON.parse(readFileSync(join(claimsDir, file), "utf-8")) as Sidecar;
    return sidecar.claims.map((c) => ({ claim: c.statement, citations: c.evidence.map((e) => evidenceCitation(e.resource)) }));
  });
}
