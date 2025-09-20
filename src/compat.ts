
import { loadConfig, loadEnv, scanForEnvKeys, diffKeys, writeReportBundle } from "./index.js";

/** Compatibility default export mirroring original loadEnv.mjs usage.
 *  Example:
 *    import dotEnv from 'envranger/compat';
 *    dotEnv({ report: true, strict: true });
 */
export default async function dotEnv(opts?: { scan?: boolean, strict?: boolean, report?: boolean, env?: string }) {
  const scan = opts?.scan ?? true;
  const strict = opts?.strict ?? false;
  const report = opts?.report ?? true;
  const envPath = opts?.env ?? ".env";

  const cfg = loadConfig();
  const envObj = loadEnv(envPath);

  let keys = new Set<string>();
  let files: string[] = [];
  if (scan) {
    const res = await scanForEnvKeys(cfg);
    keys = res.keys; files = res.files;
  }
  const d = diffKeys(keys, envObj, cfg);
  if (report) writeReportBundle(keys, files, envObj, d);
  const hasProblems = d.usedButMissing.length || d.requiredMissing.length || d.deprecatedPresent.length;
  if (strict && hasProblems) {
    throw new Error("Env validation failed (compat mode). See .loadenv/report.md");
  }
}
