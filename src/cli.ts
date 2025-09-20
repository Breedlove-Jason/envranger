#!/usr/bin/env node
import { Command } from "commander";
import boxen from "boxen";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, loadEnv, scanForEnvKeys, diffKeys, writeExample, writeTypes, setEnvVar, getEnvVar, unsetEnvVar, mergeEnvFiles, validateWithSchema, runDotenvx, writeReportBundle, renameKey } from "./index.js";
import fs from "fs";
import path from "path";

const program = new Command();
program
  .name("envranger")
  .description("Scan, validate, and manage .env files with style")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan codebase for process.env usage and print a report")
  .option("--report", "Write markdown report to .loadenv/report.md")
  .action(async (opts) => {
    const spinner = ora("Scanning for env keys...").start();
    const cfg = await loadConfig();
    const res = await scanForEnvKeys(cfg);
    spinner.succeed(`Found ${res.keys.size} keys in ${res.files.length} files.`);
    printSummary(res.keys);
    if (opts.report) writeReport(res.keys, res.files);
  });

program
  .command("check")
  .description("Load env and compare to discovered keys (and required list)")
  .option("--env <path>", "Path to env file", ".env")
  .option("--strict", "Fail (exit 1) if problems found", false)
  .option("--report", "Write markdown report to .loadenv/report.md", false)
  .action(async (opts) => {
    const cfg = await loadConfig();
    const spinner = ora("Scanning and loading env...").start();
    const res = await scanForEnvKeys(cfg);
    const env = loadEnv(opts.env);
    const diff = diffKeys(res.keys, env, cfg);
    spinner.stop();
    prettyDiff(diff);
    if (opts.report) writeReport(res.keys, []);
    const bad = diff.usedButMissing.length || diff.requiredMissing.length || diff.deprecatedPresent.length;
    process.exit(opts.strict && bad ? 1 : 0);
  });

program
  .command("example")
  .description("Generate .env.example from currently loaded env")
  .option("--env <path>", "Path to env file", ".env")
  .action(() => {
    const env = loadEnv();
    writeExample(env, ".env.example");
    console.log(chalk.green("Wrote .env.example"));
  });

program
  .command("types")
  .description("Generate env type definitions to .loadenv/env.d.ts")
  .action(async () => {
    const cfg = await loadConfig();
    const res = await scanForEnvKeys(cfg);
    writeTypes(res.keys);
    console.log(chalk.green("Wrote .loadenv/env.d.ts"));
  });

program
  .command("set")
  .description("Set a KEY=VALUE in .env")
  .argument("<pair>", "KEY=VALUE")
  .option("--env <path>", "env file", ".env")
  .action((pair, opts) => {
    const [k, ...rest] = pair.split("=");
    const v = rest.join("=");
    if (!k || v === undefined) {
      console.error(chalk.red("Usage: envranger set KEY=VALUE"));
      process.exit(1);
    }
    setEnvVar(opts.env, k, v);
    console.log(chalk.green(`Set ${k}`));
  });

program
  .command("get")
  .description("Get a KEY from .env")
  .argument("<key>", "KEY")
  .option("--env <path>", "env file", ".env")
  .action((key, opts) => {
    const v = getEnvVar(opts.env, key);
    if (v === undefined) {
      console.error(chalk.yellow(`No value for ${key}`));
      process.exit(1);
    } else {
      console.log(v);
    }
  });

program
  .command("unset")
  .description("Remove a KEY from .env")
  .argument("<key>", "KEY")
  .option("--env <path>", "env file", ".env")
  .action((key, opts) => {
    unsetEnvVar(opts.env, key);
    console.log(chalk.green(`Unset ${key}`));
  });

program.parseAsync();

function printSummary(keys: Set<string>) {
  const content = [
    chalk.bold("Discovered env keys:"),
    [...keys].sort().map(k => " • " + chalk.cyan(k)).join("\n")
  ].join("\n");
  console.log(boxen(content, { padding: 1, borderStyle: "round" }));
}

function prettyDiff(diff: any) {
  const sections: string[] = [];
  if (diff.usedButMissing.length) {
    sections.push(chalk.red.bold("Used but missing:"), diff.usedButMissing.map((k: string) => "  - " + k).join("\n"));
  }
  if (diff.requiredMissing.length) {
    sections.push(chalk.red.bold("Required missing:"), diff.requiredMissing.map((k: string) => "  - " + k).join("\n"));
  }
  if (diff.deprecatedPresent.length) {
    sections.push(chalk.yellow.bold("Deprecated present:"), diff.deprecatedPresent.map((k: string) => "  - " + k).join("\n"));
  }
  if (diff.extraInEnv.length) {
    sections.push(chalk.gray.bold("Extra in env:"), diff.extraInEnv.map((k: string) => "  - " + k).join("\n"));
  }
  if (!sections.length) sections.push(chalk.green("All good!"));
  console.log(boxen(sections.join("\n"), { padding: 1, borderStyle: "round" }));
}

function writeReport(keys: Set<string>, files: string[]) {
  const md = [
    "# Envranger Report",
    "",
    "## Discovered Keys",
    "",
    ...[...keys].sort().map(k => `- \`${k}\``),
    "",
    files.length ? "## Scanned files\n" + files.map(f=>"- "+f).join("\n") : ""
  ].join("\n");
  fs.mkdirSync(".loadenv", { recursive: true });
  fs.writeFileSync(path.join(".loadenv", "report.md"), md, "utf8");
}


program
  .command("init")
  .description("Create default config, schema, and generate example/types (non-interactive)")
  .action(async () => {
    const cfgObj = {
      scanDirs: ["src", "app", "server", "scripts"],
      ignore: ["**/node_modules/**", "**/.next/**", "**/.loadenv/**"],
      required: [], optional: [], deprecated: [], envFile: ".env"
    };
    const cfg = `/** @type {import('envranger').Config} */\nexport default ${JSON.stringify(cfgObj, null, 2)}\n`;
    fs.writeFileSync("envranger.config.mjs", cfg, "utf8");

    const schema = `import { z } from "zod";\nexport default z.object({\n  // Add specific validation rules:\n  // DATABASE_URL: z.string().url(),\n  // NEXT_PUBLIC_APP_URL: z.string().url(),\n}).catchall(z.string());\n`;
    fs.writeFileSync("envranger.schema.mjs", schema, "utf8");

    console.log(chalk.green("Wrote envranger.config.mjs"));
    console.log(chalk.green("Wrote envranger.schema.mjs (editable)"));
    await program.parseAsync(["", "", "scan"]);
    await program.parseAsync(["", "", "types"]);
    await program.parseAsync(["", "", "example"]);
  });

program
  .command("merge")
  .description("Merge multiple env files into one (first wins unless --override)")
  .argument("<dest>", "destination .env file")
  .argument("<files...>", "source env files in priority order (first wins)")
  .option("--override", "later files override earlier values", false)
  .action((dest, files, opts) => {
    mergeEnvFiles(files, dest, !!opts.override);
    console.log(chalk.green(`Merged into ${dest}`));
  });

program
  .command("schema")
  .description("Validate current env against envranger.schema.mjs (Zod)")
  .option("--env <path>", "env file", ".env")
  .option("--strict", "exit non-zero if invalid", false)
  .action(async (opts) => {
    loadEnv(opts.env);
    const res = await validateWithSchema(process.env as any);
    if (res.ok) {
      console.log(chalk.green("Schema OK"));
    } else {
      console.log(boxen([chalk.red("Schema validation failed:"), ...(res.issues||[])].join("\n"), {padding:1, borderStyle:"round"}));
      process.exit(opts.strict ? 1 : 0);
    }
  });

program
  .command("vault")
  .description("Dotenvx vault helpers (requires dotenvx). Subcommands: init, view, keys, set, push, pull")
  .argument("<subcmd>", "init|view|keys|set|push|pull")
  .option("-a, --args <args...>", "extra args passed through to dotenvx")
  .action((sub, options) => {
    let args: string[] = [];
    switch (sub) {
      case "init": args = ["vault", "new"]; break;
      case "view": args = ["vault", "view"]; break;
      case "keys": args = ["keys"]; break;
      case "set": args = ["set", ...(options.args||[])]; break;  // e.g. --env=.env.production NAME=value
      case "push": args = ["vault", "push"]; break;
      case "pull": args = ["vault", "pull"]; break;
      default:
        console.error(chalk.red("Unknown vault subcommand."));
        process.exit(1);
    }
    const res = runDotenvx(args);
    if (res.out.trim()) console.log(res.out.trim());
    if (res.err.trim()) console.error(res.err.trim());
    process.exit(res.code);
  });


program
  .command("doctor")
  .description("Run scan + check + schema in one go")
  .option("--env <path>", "env file", ".env")
  .option("--strict", "exit non-zero on problems", false)
  .option("--report", "write .loadenv/report.md and report.json", true)
  .action(async (opts) => {
    const cfg = await loadConfig();
    const res = await scanForEnvKeys(cfg);
    const env = loadEnv(opts.env);
    const diff = diffKeys(res.keys, env, cfg);
    const schemaRes = await validateWithSchema(env);
    if (opts.report) writeReportBundle(res.keys, res.files, env, diff);
    // Pretty summary
    prettyDiff(diff);
    if (!schemaRes.ok) {
      console.log(boxen(["", "Schema validation issues:", ...(schemaRes.issues||[])].join("\n"), { padding:1, borderStyle: "round" }));
    }
    const bad = diff.usedButMissing.length || diff.requiredMissing.length || diff.deprecatedPresent.length || !schemaRes.ok;
    process.exit(opts.strict && bad ? 1 : 0);
  });

program
  .command("report")
  .description("Write .loadenv/report.md and report.json")
  .option("--env <path>", "env file", ".env")
  .option("--json", "also emit .loadenv/report.json", true)
  .action(async (opts) => {
    const cfg = await loadConfig();
    const res = await scanForEnvKeys(cfg);
    const env = loadEnv(opts.env);
    const diff = diffKeys(res.keys, env, cfg);
    writeReportBundle(res.keys, res.files, env, diff);
    console.log(chalk.green("Wrote .loadenv/report.md and report.json"));
  });

program
  .command("rename")
  .description("Rename a key across code and env files (conservative; supports --dry-run)")
  .requiredOption("--from <name>", "old key")
  .requiredOption("--to <name>", "new key")
  .option("--env <paths...>", "env files to update", [".env", ".env.example"])
  .option("--globs <globs...>", "code globs", ["src/**/*.{ts,tsx,js,jsx}", "app/**/*.{ts,tsx,js,jsx}"])
  .option("--dry-run", "do not write changes", false)
  .action(async (opts) => {
    const fg = (await import("fast-glob")).default;
    const files = await fg(opts.globs, { dot: false });
    const changes = renameKey({ from: opts.from, to: opts.to, files, envFiles: opts.env, dryRun: !!opts.dryRun });
    const total = changes.reduce((a,c)=>a+c.replacements, 0);
    console.log(boxen([
      chalk.bold(`Renamed ${opts.from} -> ${opts.to}`),
      `${total} replacements across ${changes.length} files`,
      opts.dryRun ? chalk.yellow("Dry run (no files written)") : chalk.green("Changes written")
    ].join("\n"), { padding: 1, borderStyle: "round" }));
  });

program
  .command("integrate")
  .description("Scaffold integration for popular frameworks")
  .argument("<target>", "currently supported: next|node")
  .action(async (target) => {
    if (!['next','node'].includes(target)) {
      console.error(chalk.red("Supported: 'next' or 'node'."));
      process.exit(1);
    }
    // Write scripts into package.json of the current project
    const pkgPath = "package.json";
    if (!fs.existsSync(pkgPath)) {
      console.error(chalk.red("No package.json found in this directory."));
      process.exit(1);
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.scripts = pkg.scripts || {};
    pkg.scripts["env:scan"] = "envranger scan";
    pkg.scripts["env:check"] = "envranger check --strict --report";
    pkg.scripts["env:types"] = "envranger types";
    pkg.scripts["env:doctor"] = "envranger doctor --strict";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    // VSCode types hint file
    fs.mkdirSync(".loadenv", { recursive: true });
    fs.writeFileSync(".loadenv/env.d.ts", "declare namespace NodeJS { interface ProcessEnv { /* generated by envranger */ } }\n", "utf8");

    // Husky pre-commit & lint-staged
    fs.mkdirSync(".husky", { recursive: true });
    fs.writeFileSync(".husky/pre-commit", "#!/bin/sh\n. \"$(dirname \"$0\")/_/husky.sh\"\nnpx lint-staged\n", { mode: 0o755 });
    fs.writeFileSync(".lintstagedrc.json", JSON.stringify({
      "*.{ts,tsx,js,jsx}": ["eslint --fix"],
      ".env*": ["envranger check --report", "envranger types"]
    }, null, 2));

    
if (target === "node") {
  const pkgPath2 = "package.json";
  if (!fs.existsSync(pkgPath2)) { console.error(chalk.red("No package.json found.")); process.exit(1); }
  const pkg2 = JSON.parse(fs.readFileSync(pkgPath2, "utf8"));
  pkg2.scripts = pkg2.scripts || {};
  pkg2.scripts["env:scan"] = "envranger scan";
  pkg2.scripts["env:check"] = "envranger check --strict --report";
  pkg2.scripts["env:types"] = "envranger types";
  pkg2.scripts["env:doctor"] = "envranger doctor --strict";
  fs.writeFileSync(pkgPath2, JSON.stringify(pkg2, null, 2));
  fs.mkdirSync(".husky", { recursive: true });
  fs.writeFileSync(".husky/pre-commit", "#!/bin/sh\n. \"$(dirname \"$0\")/_/husky.sh\"\nnpx lint-staged\n", { mode: 0o755 });
  fs.writeFileSync(".lintstagedrc.json", JSON.stringify({
    "*.{ts,tsx,js,jsx}": ["eslint --fix"],
    ".env*": ["envranger check --report", "envranger types"]
  }, null, 2));
  console.log(chalk.green("Integrated scripts and hooks for generic Node.js."));
  console.log(chalk.gray("Remember to: npm i -D husky lint-staged && npx husky install"));
  return;
}
console.log(chalk.green("Integrated scripts, husky hook, and lint-staged config for Next.js."));
    console.log(chalk.gray("Remember to: npm i -D husky lint-staged && npx husky install"));
  });


program
  .command("wizard")
  .description("Neon Ink TUI for quick setup and presets")
  .action(async () => {
    // compiled output is JS; Ink will run via node
    const { default: run } = await import("./wizard.js");
    await run();
  });


program
  .command("presets")
  .description("List and apply key presets")
  .argument("[subcmd]", "list|apply", "list")
  .argument("[name]", "preset name for apply")
  .action(async (sub, name) => {
    const { PRESETS } = await import("./presets.js");
    if (sub === "list") {
      console.log("Available presets:");
      for (const p of PRESETS) console.log(`- ${p.name}: ${p.description}`);
      return;
    }
    if (sub === "apply") {
      const p = PRESETS.find((x:any)=>x.name.toLowerCase()===String(name||"").toLowerCase());
      if (!p) { console.error("Preset not found."); process.exit(1); }
      for (const k of p.keys) setEnvVar(".env", k, "");
      writeExample(loadEnv(), ".env.example");
      console.log(`Applied preset '${p.name}' (${p.keys.length} keys).`);
      return;
    }
    console.error("Unknown subcmd. Use 'list' or 'apply'.");
    process.exit(1);
  });


program
  .command("lint")
  .description("Lint .env file: normalize, sort, de-duplicate (preserves comments).")
  .option("--file <path>", "env file to lint", ".env")
  .option("--fix", "write changes to disk", false)
  .option("--sort", "sort keys alphabetically (pairs grouped after comments)", false)
  .action(async (opts) => {
    const { lintEnvFile } = await import("./linter.js");
    try {
      const res = lintEnvFile(opts.file, { fix: !!opts.fix, sort: !!opts.sort });
      console.log(boxen([
        "LINT REPORT",
        `Pairs before: ${res.beforePairs}`,
        `Pairs after:  ${res.afterPairs}`,
        `Changed:      ${res.changed ? "yes" : "no"}`
      ].join("\n"), { padding:1, borderStyle: "round" }));
      if (!opts.fix && res.changed) console.log("Run with --fix to write changes.");
    } catch (e:any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });
