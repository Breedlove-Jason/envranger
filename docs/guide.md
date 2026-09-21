# envRanger user guide

[Overview](../README.md) · [Website](https://envranger.jasonbreedlove.dev/) · [Issues](https://github.com/Breedlove-Jason/envranger/issues)

## Install and initialize

Use Node.js 22 or newer. Install from the GitHub source; this package has not been published to npm.

```bash
git clone https://github.com/Breedlove-Jason/envranger.git
cd envranger
npm ci
npm link
cd ../your-app
envranger init --framework node
envranger init --framework node --write
```

`init` writes missing files only: `envranger.config.json`, a blank local environment and `.env.example`. It appends ignore rules for `.env`, `.env.*` and `.envranger/`, with an exception for `.env.example`. Existing configs, files and values are preserved. Framework selection changes the default destination only: Node uses `.env`; Vite and Next use `.env.local`. It does not install framework dependencies or modify runtime code.

Git ignore rules do not untrack files already in Git. Review `git status` before committing. If secrets were previously committed, rotate them and follow your repository's history-remediation process. Add ignore entries yourself for custom paths such as `config/production.vars`; the generated rules cover `.env` filenames, not every possible name.

For a local dependency:

```bash
npm install --save-dev git+https://github.com/Breedlove-Jason/envranger.git
npx envranger --help
```

For a reproducible installation append `#<reviewed-commit-sha>` to the Git URL. npm executes the package's build during Git installation. To uninstall a linked global command, run `npm unlink --global envranger`.

## Configuration

Configuration is declarative JSON, loaded only from the project root. Use `envranger --cwd path/to/project check` to choose a root; all file paths are relative to it. Absolute paths are accepted only if inside that root. Symlink traversal is refused. Do not run concurrent writers against the same files.

```json
{
  "scanDirs": ["src", "apps"],
  "ignore": ["**/test/**", "**/*.test.ts"],
  "envFile": ".env",
  "required": ["DATABASE_URL"],
  "optional": ["LOG_LEVEL"],
  "deprecated": ["OLD_DATABASE_URL"],
  "profiles": {
    "development": [".env", ".env.local"],
    "test": [".env", ".env.test"]
  },
  "routes": {
    "apps/api/.env": ["DATABASE_URL"],
    "apps/web/.env.local": ["VITE_API_URL"]
  }
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `scanDirs` | `["."]` | Source directories; list each app for narrower monorepo scans |
| `ignore` | `[]` | Additional fast-glob ignore patterns |
| `envFile` | `.env` | Default input or edit target |
| `required` | `[]` | Must exist and be nonblank, even if unused |
| `optional` | `[]` | Missing or blank is allowed unless also explicitly required |
| `deprecated` | `[]` | Presence makes validation fail |
| `profiles` | `{}` | Named, ordered file lists; later files win |
| `routes` | `{}` | Destination filenames mapped to exact variable names |

`node_modules`, `.git`, `dist`, `build`, `.next`, `coverage` and `.envranger` directories are always excluded from scanning. Tests are not automatically excluded, except in the generated `init` config. Unknown config fields are rejected rather than silently ignored.

No `.env.production` or `.env.local` file is loaded implicitly. `--env` selects one file, and `--profile` selects a named list. They are mutually exclusive. Every selected file must exist. `profiles` lists available definitions and their precedence.

## Scanning and validation

`scan` parses JS/TS syntax, rather than searching every string that looks like code. It discovers:

```js
process.env.DATABASE_URL
process.env['API_TOKEN']
import.meta.env.VITE_API_URL
```

It does not infer destructuring, aliases, dynamic bracket keys, framework-specific wrappers or assignments from external modules. Add those names to `required`. A shadowed `process` identifier can still be reported because this is syntax analysis, not type-aware binding resolution.

`check` and `doctor` produce JSON containing `ok`, `missing`, `empty`, `deprecated`, `extra` and `sources`. Missing, whitespace-only or deprecated required/used keys exit 1. Extra keys are informational. `NODE_ENV`, `MODE`, `DEV`, `PROD`, `BASE_URL` and `SSR` are treated as optional runtime-provided names unless explicitly required. `--strict` is accepted for compatibility; failures always exit 1.

Validation checks selected files, **not** the parent shell environment. This catches configuration gaps that happen to be hidden by a developer's shell. Reports never include values. `doctor --report` writes `.envranger/report.json`; this is an explicit report write, not an environment edit.

Add a script to your application's `package.json` after installing the tool locally:

```json
{ "scripts": { "env:check": "envranger check --profile test" } }
```

In CI, create the selected test environment file from nonsecret fixtures or your CI secret store, then run `npm run env:check`. envRanger does not fetch secrets from your CI provider. Never commit real credentials as fixtures.

## Editing and inspecting

Mutating commands preview by default. Add `--write` to `init`, `set`, `unset`, `example`, `types`, `merge` or `route` to apply the plan. Preview output contains paths and key names, not values.

```bash
envranger set PORT 3000
envranger set PORT 3000 --write
envranger set API_TOKEN --stdin --write
envranger get API_TOKEN
envranger get API_TOKEN --reveal
envranger unset OLD_KEY --write
```

`set --stdin` reads until EOF and preserves every byte of text, including trailing newlines. Pipe from your trusted password manager or a local secret-input mechanism; do not paste secrets into shell command arguments. For nonsecret examples, `printf %s 'hello' | envranger set GREETING --stdin --write` adds no newline. `get --reveal` prints the value followed by a newline.

`set` and `unset` preserve unrelated raw entries and comments. The edited assignment is replaced in normalized form; an inline comment attached to that assignment is removed. Duplicate keys anywhere in an edited file cause a refusal. `lint` reports syntax and duplicates; it never silently picks a duplicate or rewrites content.

`diff LEFT RIGHT` lists only-left, only-right and changed key names. `merge DEST SOURCE...` flattens files, taking the last source value for each key and sorting names. It drops original comments. Existing destinations require `--overwrite`; writes still require `--write`.

## Routing and recovery

Routing copies keys listed in `routes` from the selected input/profile to each destination. It never infers whether a value is safe for a browser and never moves or removes source values. Never map database credentials, private tokens or server secrets to public client variables.

```bash
envranger route --profile development
envranger route --profile development --write
# Only if changing existing destination values is intentional:
envranger route --profile development --overwrite --write
```

All destinations are parsed and checked before writing. Missing source keys, duplicates or differing existing destination values stop the plan. Matching values remain unchanged; unrelated keys stay intact. `--overwrite` allows replacement of differing mapped values. It does not authorize deleting unrelated variables.

Changed existing files are copied to `.envranger/backups/` with a timestamp, unique ID and original basename. Review the CLI's destination paths to identify which file you changed. To restore a backup, copy its contents to the original destination using your file manager or editor, then rerun `lint` and `check`.

Backup directories request mode `0700`; backups and replacement files request mode `0600` on POSIX. Windows uses its own ACL behavior. These are plaintext backups, not encryption. Do not commit or upload them; clean them up after confirming the changes. Existing permissions on parent directories are not changed.

Individual files use a temporary sibling file and atomic rename. A route spanning multiple files is **not transactional**: a disk or permission failure during writing can leave earlier destinations updated. Backups provide recovery. There is no concurrent-writer lock; use one envRanger process per project at a time.

## Profiles and child processes

```bash
envranger list --profile development
envranger run --profile development -- node server.js
envranger run --profile test --override -- node --test
```

Profile lists use later-file precedence. For `run`, inherited shell values win by default; `--override` makes selected file values win. Command options belong before `--`; everything after it is the executable and its arguments. The executable is started directly without a shell; shell builtins and Windows `.cmd` shims are not portable executable targets. Prefer `node path/to/script.js`. Child exit status is propagated; spawn errors or signals return 1. Child stdout/stderr are inherited and are not redacted by envRanger.

## Examples and types

`example` combines scanned names, selected input keys, required and optional keys, sorts them and writes **blank** placeholders. It never copies values or parent-shell variables. It replaces the entire example when `--write` is supplied; the old example is backed up. Output must end in `.example`.

`types` generates optional `NodeJS.ProcessEnv` string declarations at `.envranger/env.d.ts`. Include this file in your application's `tsconfig.json` if you want the declarations. Keys remain optional because type generation does not prove that runtime values exist. This command does not generate Vite `ImportMetaEnv` declarations or runtime schemas.

## File format and limits

Names use `[A-Za-z_][A-Za-z0-9_]*`. Supported syntax includes blank values, whitespace around assignments, a leading `export`, full-line comments, unquoted inline comments, single/double/backtick quotes and multiline quoted values. Double-quoted `\n` and `\r` are decoded. Expansion such as `${OTHER_KEY}` and `$(command)` remains literal text; nothing is evaluated.

The matching quote closes a value; escaped quote delimiters are not supported. The writer chooses a quote delimiter absent from the value and refuses combinations it cannot represent losslessly. NUL values are refused. Invalid syntax reports a key or line number without echoing contents. The parser is intentionally stricter than some dotenv implementations. If your runtime expands variables or accepts other escape syntax, test compatibility before adopting generated files.

Publicly prefixed variables (for example `VITE_` or `NEXT_PUBLIC_`) can become visible in browser bundles. envRanger cannot determine whether a value is actually secret. Routing is an explicit allowlist, not an automatic confidentiality classifier.

## Migrating from 0.1

Version 0.2 replaces unfinished experimental behavior with a smaller supported interface.

| 0.1 behavior | 0.2 replacement |
| --- | --- |
| Executable `.js` / `.mjs` / `.cjs` config | `envranger.config.json`; preserve supported scan/required/optional/deprecated/envFile fields |
| `set KEY=VALUE` | `set KEY VALUE`, preferably `set KEY --stdin --write` for secrets |
| Immediate environment edits | Preview by default; append `--write` |
| `get` prints values | Masked by default; explicit `--reveal` |
| `merge` first source wins | Last source wins; existing output requires `--overwrite` |
| `check` relies on shell environment | Selected files only; validation failure exits 1 |
| Examples include inherited shell keys | Only input, configuration and scanned keys |
| `.loadenv` reports/types | `.envranger` reports/types/backups |
| React Ink wizard, presets, automatic integration hooks, rename, schema and vault wrappers | Removed from the supported CLI; configure JSON routes/profiles and use your framework or secret manager directly |
| Compatibility loader and old API exports | Import the typed 0.2 ESM API; review signatures before upgrading |

The removed features are retained in Git history. There is no implicit dependency installation, shell-based vault fallback, hook overwrite or executable schema loading. npm registry publication, encrypted secret storage and cloud provider synchronization are outside this release.
