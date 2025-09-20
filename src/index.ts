
import { config as dotenvx } from "@dotenvx/dotenvx";
import fg from "fast-glob";
import fs from "fs";
import path from "path";

export type Config = {
  scanDirs?: string[];
  ignore?: string[];
  required?: string[];
  optional?: string[];
  deprecated?: string[];
  envFile?: string;
};

export type ScanResult = {
  keys: Set<string>;
  files: string[];
};

export async function loadConfig(cwd = process.cwd()): Promise<Config> {
  const defaults: Config = {
    scanDirs: ["src", "app", "server", "scripts"],
    ignore: ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/.loadenv/**"],
    required: [], optional: [], deprecated: [], envFile: ".env",
  };
  const candidates = [
    "envranger.config.mjs",
    "envranger.config.cjs",
    "envranger.config.js",
    "envranger.config.json"
  ];
  for (const file of candidates) {
    const p = path.join(cwd, file);
    if (fs.existsSync(p)) {
      if (p.endsWith(".json")) {
        return { ...defaults, ...JSON.parse(fs.readFileSync(p, "utf8")) };
      } else {
        // dynamic import for ESM/CJS
        const mod = await requireOrImport(p);
        return { ...defaults, ...(mod.default ?? mod) };
      }
    }
  }
  return defaults;
}

async function requireOrImport(p: string): Promise<any> {
  // Node can import ESM via dynamic import
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (p.endsWith(".cjs")) return require(p);
  return (await import(pathToFileURL(p).toString()));
}


export function loadEnv(envPath = ".env"): Record<string,string> {
  // Load .env or .env.vault via dotenvx (respects DOTENV_KEY if set)
  dotenvx({ path: envPath });
  // Return a shallow copy of current process.env (stringified keys only)
  const obj: Record<string,string> = {};
  for (const [k,v] of Object.entries(process.env)) {
    if (typeof v === "string") obj[k] = v;
  }
  return obj;
}

export async function scanForEnvKeys(cfg: Config, cwd = process.cwd()): Promise<ScanResult> {
  const patterns = (cfg.scanDirs ?? []).map(d => path.join(d, "**/*.{ts,tsx,js,jsx,mjs,cjs}"));
  const files = await fg(patterns, { cwd, ignore: cfg.ignore, dot: false });
  const keys = new Set<string>();
  const rx = /process\.env\.([A-Z0-9_]+)/g;
  for (const rel of files) {
    const abs = path.join(cwd, rel);
    try {
      const txt = fs.readFileSync(abs, "utf8");
      for (const m of txt.matchAll(rx)) {
        keys.add(m[1]);
      }
    } catch {}
  }
  return { keys, files };
}

export function diffKeys(found: Set<string>, envObj: Record<string,string>, cfg: Config) {
  const present = new Set(Object.keys(envObj));
  const required = new Set(cfg.required ?? []);
  const optional = new Set(cfg.optional ?? []);
  const deprecated = new Set(cfg.deprecated ?? []);

  const usedButMissing = [...found].filter(k => !present.has(k));
  const requiredMissing = [...required].filter(k => !present.has(k));
  const deprecatedPresent = [...deprecated].filter(k => present.has(k));
  const extraInEnv = [...present].filter(k => !found.has(k) && !required.has(k) && !optional.has(k));

  return { usedButMissing, requiredMissing, deprecatedPresent, extraInEnv };
}

export function writeExample(envObj: Record<string,string>, dest=".env.example") {
  const lines = Object.keys(envObj).sort().map(k => `${k}=`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, lines.join("\n") + "\n", "utf8");
}

export function writeTypes(keys: Set<string>, dest=".loadenv/env.d.ts") {
  const lines = [
    "declare namespace NodeJS {",
    "  interface ProcessEnv {",
    ...[...keys].sort().map(k => `    ${k}: string;`),
    "  }",
    "}",
    ""
  ];
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, lines.join("\n"), "utf8");
}

export function setEnvVar(file: string, key: string, value: string) {
  const exists = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const rx = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
  const line = `${key}=${escapeValue(value)}`;
  const next = rx.test(exists) ? exists.replace(rx, line) : (exists.trimEnd() + (exists.endsWith("\n")?"":"\n") + line + "\n");
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, next, "utf8");
}

export function getEnvVar(file: string, key: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  const txt = fs.readFileSync(file, "utf8");
  const rx = new RegExp(`^${escapeRegExp(key)}=(.*)$`, "m");
  const m = txt.match(rx);
  return m ? m[1] : undefined;
}

export function unsetEnvVar(file: string, key: string) {
  if (!fs.existsSync(file)) return;
  const txt = fs.readFileSync(file, "utf8");
  const rx = new RegExp(`^${escapeRegExp(key)}=.*\n?`, "m");
  const next = txt.replace(rx, "");
  fs.writeFileSync(file, next, "utf8");
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeValue(v: string) {
  // Basic escaping: wrap if contains spaces or # or quotes
  if (/\s|#|"/.test(v)) {
    const escaped = v.replace(/"/g, '\"');
    return `"${escaped}"`;
  }
  return v;
}


type ZodSchemaLike = { safeParse: (obj: any) => { success: boolean, error?: { issues: { path: (string|number)[], message: string }[] } } };
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";

/** Load user schema from envranger.schema.mjs/cjs/js if present */
export async function loadSchema(cwd = process.cwd()): Promise<ZodSchemaLike | null> {
  const candidates = ["envranger.schema.mjs", "envranger.schema.cjs", "envranger.schema.js"];
  for (const file of candidates) {
    const p = path.join(cwd, file);
    if (fs.existsSync(p)) {
      const mod: any = p.endsWith(".cjs") ? require(p) : (await import(pathToFileURL(p).toString()));
      const schema = mod.default ?? mod.schema ?? mod;
      // naive check
      if (schema && typeof schema.safeParse === "function") return schema as ZodSchema<any>;
    }
  }
  return null;
}

/** Validate env with loaded Zod schema. Returns formatted issues or null if ok. */
export async function validateWithSchema(envObj: Record<string,string>, cwd = process.cwd()): Promise<{ ok: boolean, issues?: string[] }> {
  const schema = await loadSchema(cwd);
  if (!schema) return { ok: true };
  // Convert strings to something the schema expects; keep strings by default
  const res = schema.safeParse(envObj);
  if (res.success) return { ok: true };
  const issues = res.error.issues.map(i => `• ${i.path.join(".") || "(root)"} - ${i.message}`);
  return { ok: false, issues };
}

/** Merge env files (first wins by default unless override=true) */
export function mergeEnvFiles(files: string[], dest: string, override=false) {
  const parse = (txt: string): Record<string,string> => {
    const out: Record<string,string> = {};
    for (const line of txt.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) continue;
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      out[m[1]] = m[2];
    }
    return out;
  };
  const merged: Record<string,string> = {};
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const cur = parse(fs.readFileSync(f, "utf8"));
    for (const [k,v] of Object.entries(cur)) {
      if (!override && merged[k] !== undefined) continue;
      merged[k] = v;
    }
  }
  const lines = Object.keys(merged).sort().map(k => `${k}=${merged[k]}`);
  fs.writeFileSync(dest, lines.join("\n") + "\n", "utf8");
}

/** Run dotenvx subcommand (requires dotenvx installed or resolvable via npx) */
export function runDotenvx(args: string[], cwd = process.cwd()): { code: number, out: string, err: string } {
  // Prefer local node_modules/.bin/dotenvx else fallback to npx
  const local = path.join(cwd, "node_modules", ".bin", "dotenvx");
  let cmd = "", argv: string[] = [];
  if (fs.existsSync(local)) {
    cmd = local; argv = args;
  } else {
    cmd = "npx"; argv = ["-y", "dotenvx", ...args];
  }
  const res = spawnSync(cmd, argv, { cwd, encoding: "utf8" });
  return { code: res.status ?? 0, out: res.stdout ?? "", err: res.stderr ?? "" };
}


export type Diff = ReturnType<typeof diffKeys>;

export function maskValue(v: string): string {
  if (!v) return v;
  // mask everything but first 3 & last 2, capped
  const head = v.slice(0, 3);
  const tail = v.slice(-2);
  return `${head}${"•".repeat(Math.max(2, Math.min(12, v.length-5))) }${tail}`;
}

export function buildMarkdownReport(keys: Set<string>, files: string[], env: Record<string,string> | null, diff: Diff | null) {
  const lines: string[] = ["# Envranger Report", ""];
  lines.push("## Discovered Keys", "");
  for (const k of [...keys].sort()) lines.push(`- \`${k}\``);
  if (files.length) {
    lines.push("", "## Scanned files", "");
    for (const f of files) lines.push(`- ${f}`);
  }
  if (env) {
    lines.push("", "## Loaded env (masked preview)", "");
    for (const k of Object.keys(env).sort()) lines.push(`- **${k}**: \`${maskValue(env[k] as string)}\``);
  }
  if (diff) {
    const sections: [string, string[]][] = [
      ["Used but missing", diff.usedButMissing],
      ["Required missing", diff.requiredMissing],
      ["Deprecated present", diff.deprecatedPresent],
      ["Extra in env", diff.extraInEnv],
    ];
    lines.push("", "## Diff", "");
    for (const [title, arr] of sections) {
      if (!arr.length) continue;
      lines.push(`### ${title}`, "");
      for (const k of arr) lines.push(`- ${k}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function buildJsonReport(keys: Set<string>, files: string[], env: Record<string,string> | null, diff: Diff | null) {
  return JSON.stringify({
    discoveredKeys: [...keys].sort(),
    files,
    envMasked: env ? Object.fromEntries(Object.entries(env).map(([k,v]) => [k, maskValue(String(v))])) : null,
    diff
  }, null, 2);
}

export function writeReportBundle(keys: Set<string>, files: string[], env: Record<string,string> | null, diff: Diff | null) {
  fs.mkdirSync(".loadenv", { recursive: true });
  fs.writeFileSync(path.join(".loadenv", "report.md"), buildMarkdownReport(keys, files, env, diff), "utf8");
  fs.writeFileSync(path.join(".loadenv", "report.json"), buildJsonReport(keys, files, env, diff), "utf8");
}

/** Rename a key across env files and code (dry-run supported). Very conservative replace. */
export function renameKey({ from, to, files, envFiles, dryRun=false }: { from: string, to: string, files: string[], envFiles: string[], dryRun?: boolean }) {
  const changes: { file: string, replacements: number }[] = [];
  const codeRx = new RegExp(`process\\.env\\.${from}\\b`, "g");
  const envRx = new RegExp(`^${from}=(.*)$`, "m");
  for (const f of files) {
    try {
      const txt = fs.readFileSync(f, "utf8");
      const next = txt.replace(codeRx, `process.env.${to}`);
      if (next !== txt) {
        if (!dryRun) fs.writeFileSync(f, next, "utf8");
        const count = (txt.match(codeRx) || []).length;
        changes.push({ file: f, replacements: count });
      }
    } catch {}
  }
  for (const f of envFiles) {
    try {
      const txt = fs.readFileSync(f, "utf8");
      const next = txt.replace(envRx, `${to}=$1`);
      if (next !== txt) {
        if (!dryRun) fs.writeFileSync(f, next, "utf8");
        const count = (txt.match(envRx) || []).length;
        changes.push({ file: f, replacements: count });
      }
    } catch {}
  }
  return changes;
}
