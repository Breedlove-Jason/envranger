import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadFiles } from './index.js';
import { assertKey } from './files.js';
import { isMetadata, type KeyOptions } from './crypto.js';
export type LoadEnvOptions = KeyOptions & {
  root: string | URL;
  scope?: 'frontend' | 'backend' | 'root';
  profile?: string;
  files?: string[];
  required?: string[];
  allowRoot?: boolean;
  populate?: boolean;
  override?: boolean;
};
/** Node/build-time only. Scopes are application projections, not user authentication. */
export function loadEnv(opts: LoadEnvOptions): Readonly<Record<string,string>> {
  const root = path.resolve(opts.root instanceof URL ? fileURLToPath(opts.root) : opts.root);
  const cfg = loadConfig(root); const scope = opts.scope ?? 'backend';
  if (!['frontend','backend','root'].includes(scope)) throw new Error('Unknown loader scope.');
  if (scope === 'root' && !(cfg.access?.root === true && opts.allowRoot === true)) throw new Error('Root access requires access.root in config and allowRoot: true in the trusted caller.');
  const allow = scope === 'root' ? undefined : cfg.access?.[scope];
  if (scope !== 'root' && !allow) throw new Error(`Configure access.${scope} with an explicit key list.`);
  if (scope === 'frontend' && opts.populate) throw new Error('Frontend projections cannot populate process.env. Pass the returned object to your build configuration.');
  if (opts.files && opts.profile) throw new Error('Choose files or profile.');
  if (opts.profile && !Object.hasOwn(cfg.profiles,opts.profile)) throw new Error('Unknown loader profile.');
  const selectedFiles = opts.files ?? (opts.profile ? cfg.profiles[opts.profile] : [cfg.envFile]);
  if (!selectedFiles.length) throw new Error('Select at least one environment file.');
  const loaded = loadFiles(root,selectedFiles,opts).env;
  const selected: Record<string,string> = Object.create(null);
  for (const key of allow ?? Object.keys(loaded)) {
    assertKey(key);
    if (isMetadata(key)) throw new Error('Encryption keys cannot be returned by the loader.');
    if (Object.hasOwn(loaded,key)) selected[key]=loaded[key];
  }
  const required = opts.required ?? cfg.required.filter(key=>scope==='root' || allow!.includes(key));
  for (const key of required) {
    assertKey(key);
    if (scope !== 'root' && !allow!.includes(key)) throw new Error(`Required key ${key} is outside the selected scope.`);
  }
  // Parent values may override selected names only; unrelated process variables never escape.
  if (opts.populate && !opts.override) for (const key of Object.keys(selected)) if (process.env[key]!==undefined) selected[key]=process.env[key]!;
  const missing=required.filter(key=>!selected[key]?.trim());
  if(missing.length)throw new Error(`Missing required variables for ${scope}: ${missing.join(', ')}`);
  // Validate everything before mutating the process; failed loads never partially inject.
  if(opts.populate) Object.assign(process.env,selected);
  return Object.freeze(selected);
}
export default loadEnv;
