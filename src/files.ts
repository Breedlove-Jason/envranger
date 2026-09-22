import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type Entry = { raw: string; key?: string; value?: string };
export function assertKey(key: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid variable name. Use letters, numbers and underscores; do not start with a number.');
}
/** Parse literal dotenv values. Expansion and executable shell syntax are never evaluated. */
export function parseDocument(text: string): Entry[] {
  const lines = text.replace(/^\uFEFF/, '').split(/(?<=\n)/);
  const entries: Entry[] = [];
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i];
    if (!raw.trim() || /^\s*#/.test(raw)) { entries.push({raw}); continue; }
    const match = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\r\n]*)/);
    if (!match) throw new Error(`Invalid .env syntax at line ${i + 1}; no values displayed.`);
    const key = match[1];
    let rest = match[2];
    let value: string;
    if (/^["'`]/.test(rest)) {
      const quote = rest[0];
      while (rest.indexOf(quote, 1) < 0 && i + 1 < lines.length) {
        raw += lines[++i];
        rest += '\n' + lines[i].replace(/\r?\n$/, '');
      }
      const end = rest.indexOf(quote, 1);
      if (end < 0 || !/^\s*(?:#.*)?$/.test(rest.slice(end + 1))) throw new Error(`Invalid quoted value for ${key}; no values displayed.`);
      value = rest.slice(1, end);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    } else value = rest.split('#')[0].trim();
    entries.push({raw, key, value});
  }
  return entries;
}
export function values(entries: Entry[]): Record<string, string> {
  const result: Record<string,string> = Object.create(null);
  for (const entry of entries) if (entry.key !== undefined) result[entry.key] = entry.value!;
  return result;
}
export function duplicates(entries: Entry[]): string[] {
  const seen = new Set<string>(); const dup = new Set<string>();
  for (const e of entries) if (e.key) { if (seen.has(e.key)) dup.add(e.key); seen.add(e.key); }
  return [...dup].sort();
}
export function readDocument(file: string, allowMissing = false): Entry[] {
  if (!fs.existsSync(file) && allowMissing) return [];
  return parseDocument(fs.readFileSync(file, 'utf8'));
}
export function encode(value: string): string {
  if (value.includes('\0')) throw new Error('NUL characters cannot be stored in environment variables.');
  if (!/[\s#"'`]/.test(value)) return value;
  // Single quotes keep literal backslash sequences intact. Reject unrepresentable values.
  for (const quote of ["'", '`', '"']) {
    if (!value.includes(quote) && (quote !== '"' || !/\\[nr]/.test(value))) return quote + value + quote;
  }
  throw new Error('Value contains an unsupported combination of quotes. No file was changed.');
}
export function update(entries: Entry[], key: string, value?: string): string {
  assertKey(key);
  const dup = duplicates(entries);
  if (dup.length) throw new Error(`Resolve duplicate keys before editing: ${dup.join(', ')}`);
  let found = false;
  const newline = entries.some(e => e.raw.endsWith('\r\n')) ? '\r\n' : '\n';
  const next = entries.map(e => {
    if (e.key !== key) return e.raw;
    found = true;
    return value === undefined ? '' : `${key}=${encode(value)}${newline}`;
  }).join('');
  return !found && value !== undefined ? next + (next && !next.endsWith('\n') ? newline : '') + `${key}=${encode(value)}${newline}` : next;
}
/** Existing files are backed up privately; individual file replacements are atomic. */
export function writeFile(file: string, text: string, root = process.cwd(), backup = true): void {
  const abs = safePath(root, file);
  fs.mkdirSync(path.dirname(abs), {recursive:true});
  if (fs.existsSync(abs)) {
    if (fs.readFileSync(abs, 'utf8') === text) return;
    if (backup) {
      const backupDir = safePath(root, '.envranger/backups');
      fs.mkdirSync(backupDir, {recursive:true, mode:0o700});
      fs.writeFileSync(path.join(backupDir, `${Date.now()}-${randomUUID()}-${path.basename(abs)}`), fs.readFileSync(abs), {mode:0o600, flag:'wx'});
    }
  }
  const temp = `${abs}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, text, {mode:0o600, flag:'wx'}); fs.renameSync(temp, abs); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
/** Keep targets within the project and refuse symbolic-link traversal. */
export function safePath(root: string, file: string): string {
  const base = fs.realpathSync(root); const target = path.resolve(base, file);
  const rel = path.relative(base, target);
  if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new Error('File paths must stay inside the project root.');
  let current = base;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) || (() => { try { fs.lstatSync(current); return true; } catch { return false; } })()) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links are not supported for environment files.');
    }
  }
  return target;
}
