import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import ts from 'typescript';
import { assertKey, duplicates, readDocument, safePath, values, update, writeFile } from './files.js';
export * from './files.js';
export * from './crypto.js';
import { decodeDocument, publicMetadata, encryptedEdit, isMetadata, type KeyOptions } from './crypto.js';
export type Config = {
  scanDirs: string[]; ignore: string[]; required: string[]; optional: string[]; deprecated: string[];
  envFile: string; profiles: Record<string,string[]>; routes: Record<string,string[]>;
  access?: {frontend?:string[]; backend?:string[]; root?:boolean};
};
export function loadConfig(root = process.cwd()): Config {
  const file = safePath(root, 'envranger.config.json');
  const defaults: Config = {scanDirs:['.'], ignore:[], required:[], optional:[], deprecated:[], envFile:'.env', profiles:{}, routes:{}, access:{}};
  if (!fs.existsSync(file)) {
    if (['js','mjs','cjs'].some(ext => fs.existsSync(path.join(root, `envranger.config.${ext}`)))) throw new Error('Migrate your executable config to envranger.config.json. See docs/guide.md.');
    return defaults;
  }
  let obj: any;
  try { obj = JSON.parse(fs.readFileSync(file,'utf8')); } catch { throw new Error('Invalid envranger.config.json; contents omitted.'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Config must be an object.');
  for (const key of Object.keys(obj)) if (!Object.hasOwn(defaults,key)) throw new Error(`Unknown config option: ${key}`);
  const cfg = {...defaults,...obj};
  for (const k of ['scanDirs','ignore','required','optional','deprecated'] as const) {
    if (!Array.isArray(cfg[k]) || cfg[k].some((v: unknown) => typeof v !== 'string')) throw new Error(`${k} must be a string array.`);
  }
  for (const key of [...cfg.required,...cfg.optional,...cfg.deprecated]) assertKey(key);
  if (typeof cfg.envFile !== 'string') throw new Error('envFile must be a path.');
  safePath(root,cfg.envFile);
  for (const name of ['profiles','routes'] as const) {
    if (!cfg[name] || typeof cfg[name] !== 'object' || Array.isArray(cfg[name])) throw new Error(`${name} must be an object.`);
    for (const [key, list] of Object.entries(cfg[name]) as [string,any][]) {
      if (!Array.isArray(list) || !list.length || list.some((v: unknown) => typeof v !== 'string')) throw new Error(`${name} entries must contain a nonempty string array.`);
      if (name === 'routes') { safePath(root,key); for (const k of list) assertKey(k); }
      else for (const f of list) safePath(root,f);
    }
  }
  if (!cfg.access || typeof cfg.access !== 'object' || Array.isArray(cfg.access)) throw new Error('access must be an object.');
  for (const key of Object.keys(cfg.access)) if (!['frontend','backend','root'].includes(key)) throw new Error('Unknown access scope.');
  for (const scope of ['frontend','backend'] as const) if (cfg.access[scope] !== undefined) {
    if (!Array.isArray(cfg.access[scope])) throw new Error('Scope key lists must be arrays.');
    for (const key of cfg.access[scope]) { assertKey(key); if (isMetadata(key)) throw new Error('Scopes cannot expose encryption keys.'); }
  }
  if (cfg.access.root !== undefined && typeof cfg.access.root !== 'boolean') throw new Error('access.root must be boolean.');
  for (const dir of cfg.scanDirs) if (dir !== '.') safePath(root,dir);
  return cfg;
}
export async function scan(cfg: Config, root = process.cwd()) {
  const files = await fg(cfg.scanDirs.map(d => `${d}/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}`), {cwd:root, followSymbolicLinks:false, ignore:['**/node_modules/**','**/.git/**','**/dist/**','**/build/**','**/.next/**','**/coverage/**','**/.envranger/**',...cfg.ignore]});
  const occurrences: Record<string,string[]> = Object.create(null);
  for (const file of files.sort()) {
    const source = ts.createSourceFile(file,fs.readFileSync(safePath(root,file),'utf8'),ts.ScriptTarget.Latest,true);
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const expression = node.expression.getText(source).replace(/\s/g,'');
        if (expression === 'process.env' || expression === 'import.meta.env') {
          const key = ts.isPropertyAccessExpression(node) ? node.name.text : node.argumentExpression && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
          if (key && !isMetadata(key) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            (occurrences[key] ??= []).push(`${file}:${line}`);
          }
        }
      }
      ts.forEachChild(node,visit);
    };
    visit(source);
  }
  return {keys:Object.keys(occurrences).sort(), files, occurrences};
}
export function loadFiles(root: string, files: string[], opts: KeyOptions = {}) {
  const env: Record<string,string> = Object.create(null); const sources: Record<string,string> = Object.create(null);
  for (const file of files) {
    const doc = readDocument(safePath(root,file));
    if (duplicates(doc).length) throw new Error(`Duplicate keys in ${file}: ${duplicates(doc).join(', ')}`);
    for (const [key,value] of Object.entries(decodeDocument(root,file,doc,opts))) { env[key]=value; sources[key]=file; }
  }
  return {env,sources};
}
export function check(keys: string[], env: Record<string,string>, cfg: Config) {
  const optional = new Set([...cfg.optional, 'NODE_ENV','MODE','DEV','PROD','BASE_URL','SSR']);
  const expected = [...new Set([...keys.filter(k => !optional.has(k)),...cfg.required])].sort();
  return {missing:expected.filter(k => !(k in env)), empty:expected.filter(k => k in env && !env[k].trim()), deprecated:cfg.deprecated.filter(k => k in env), extra:Object.keys(env).filter(k => !keys.includes(k) && !cfg.required.includes(k) && !optional.has(k)).sort()};
}
export function routePlan(root: string, cfg: Config, env: Record<string,string>, overwrite = false, opts: KeyOptions & {allowPlaintext?:boolean; encryptedSource?:boolean} = {}) {
  if (!Object.keys(cfg.routes).length) throw new Error('No routes configured. Add destination paths and key lists to envranger.config.json.');
  const plan: {file:string; keys:string[]; content:string}[] = [];
  const targets = new Set<string>();
  for (const [file, keys] of Object.entries(cfg.routes)) {
    const target = safePath(root,file);
    if (targets.has(target)) throw new Error('Multiple routes resolve to the same destination. Combine their key lists.');
    targets.add(target);
    let doc = readDocument(target,true); const meta = publicMetadata(doc);
    if (opts.encryptedSource && !meta && !opts.allowPlaintext) throw new Error(`Routing decrypted values to ${file} requires --plaintext, or encrypt that destination first.`);
    const existing = meta && overwrite ? values(doc) : decodeDocument(root,file,doc,opts);
    if (keys.some(isMetadata)) throw new Error('Routes cannot distribute encryption keys.');
    if (duplicates(doc).length) throw new Error(`Duplicate keys in ${file}.`);
    const missing = keys.filter(k => !(k in env));
    if (missing.length) throw new Error(`Source is missing keys required for ${file}: ${missing.join(', ')}`);
    const conflicts = keys.filter(k => k in existing && existing[k] !== env[k]);
    if (conflicts.length && !overwrite) throw new Error(`Conflicting values in ${file}: ${conflicts.join(', ')}. Use --overwrite only after reviewing destinations.`);
    let content = doc.map(e=>e.raw).join('');
    const changed = keys.filter(k => existing[k] !== env[k]);
    for (const key of changed) { content = encryptedEdit(doc,key,env[key]); doc = parse(content); }
    if (changed.length) plan.push({file,keys:changed,content});
  }
  return plan;
}
import { parseDocument as parse } from './files.js';
export function applyPlan(root: string, plan: ReturnType<typeof routePlan>) {
  for (const item of plan) writeFile(item.file,item.content,root);
}
