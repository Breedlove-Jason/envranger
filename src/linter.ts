
// Simple .env parser/linter that preserves comments and ordering.
// On --fix, normalizes duplicates and sorts keys (unless keepOrder is true).
import fs from "fs";

export type EnvEntry =
  | { type: "comment"; text: string }
  | { type: "blank" }
  | { type: "pair"; key: string; value: string };

export function parseEnvText(txt: string): EnvEntry[] {
  const lines = txt.split(/\r?\n/);
  const out: EnvEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) { out.push({ type: "blank" }); continue; }
    if (/^\s*#/.test(line)) { out.push({ type: "comment", text: line }); continue; }
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) {
      out.push({ type: "pair", key: m[1], value: m[2] });
    } else {
      // fallback: keep as comment to avoid destructive edits
      out.push({ type: "comment", text: "# " + line });
    }
  }
  return out;
}

export function serializeEnv(entries: EnvEntry[]): string {
  return entries.map(e => e.type === "pair" ? `${e.key}=${e.value}` : e.type === "comment" ? e.text : "").join("\n") + "\n";
}

export function lintEnvEntries(entries: EnvEntry[], { sort=false }: { sort?: boolean }) {
  // de-duplicate pairs (last wins), preserve first block of comments unless sorting
  const seen: Record<string, number> = {};
  const dedup: EnvEntry[] = [];
  for (const e of entries) {
    if (e.type !== "pair") { dedup.push(e); continue; }
    if (seen[e.key] !== undefined) {
      // replace earlier occurrence value
      const idx = seen[e.key];
      dedup[idx] = e;
    } else {
      seen[e.key] = dedup.length;
      dedup.push(e);
    }
  }
  if (!sort) return dedup;
  const pairs = dedup.filter(e => e.type === "pair") as Extract<EnvEntry, {type:"pair"}>[];
  const others = dedup.filter(e => e.type !== "pair");
  pairs.sort((a,b)=> a.key.localeCompare(b.key));
  // Keep comments at top then pairs
  return [...others.filter(o=>o.type!=="blank"), {type:"blank"} as EnvEntry, ...pairs];
}

export function lintEnvFile(path: string, { fix=false, sort=false } = {}) {
  if (!fs.existsSync(path)) throw new Error(`File not found: ${path}`);
  const txt = fs.readFileSync(path, "utf8");
  const entries = parseEnvText(txt);
  const beforePairs = entries.filter(e=>e.type==="pair").length;
  const keys = new Set(entries.filter(e=>e.type==="pair").map((e:any)=>e.key));
  const result = lintEnvEntries(entries, { sort });
  const afterTxt = serializeEnv(result);
  const afterPairs = result.filter(e=>e.type==="pair").length;
  if (fix && afterTxt !== txt) fs.writeFileSync(path, afterTxt, "utf8");
  return { beforePairs, afterPairs, keys: [...keys].sort(), changed: afterTxt !== txt };
}
