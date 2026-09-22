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

Backup directories request mode `0700`; backups and replacement files request mode `0600` on POSIX. Windows uses its own ACL behavior. Backups preserve the original bytes: plaintext files produce plaintext backups; encrypted files produce ciphertext backups. The encrypt command creates no new plaintext backup. Do not commit or upload them; clean them up after confirming the changes. Existing permissions on parent directories are not changed.

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

The removed features are retained in Git history. There is no implicit dependency installation, shell-based vault fallback, hook overwrite or executable schema loading. npm registry publication and cloud provider synchronization remain outside this release. Version 0.3 adds dotenvx encryption and a scoped loader as described below.

## Dotenvx encryption and the shared loader

Version 0.3 uses the [official dotenvx primitives](https://dotenvx.com/docs/sdk/nodejs/primitives/) for encryption, key generation and decryption. It also ships a pinned `@dotenvx/dotenvx` dependency and tests that its SDK can read envRanger's encrypted output. This is the current `DOTENV_PUBLIC_KEY` / `DOTENV_PRIVATE_KEY` format, not the legacy `.env.vault` / `DOTENV_KEY` scheme.

### Encrypt and retain the public key

```bash
envranger encrypt --env .env
envranger encrypt --env .env --write
envranger keys --env .env
envranger list --env .env
envranger check --env .env
```

`encrypt` previews by default. On `--write`, application values become ciphertext and the file keeps its public key. Generated private keys are written separately to `.env.keys` beside the selected `.env` file; custom `--keys-file secure/keys` paths are supported inside the project. The private key file is written before replacing the environment file, and an exact ignore entry is added first. Encryption does not leave a new plaintext backup behind. Any plaintext backups from earlier edits still exist and should be reviewed separately.

Existing public keys are preserved. Existing matching named local private keys can be reused when adding public metadata. A supplied public key that conflicts with the file's saved key is rejected. This command does not rotate keys or revoke a recipient.

Key names follow the environment: `.env` uses `DOTENV_PRIVATE_KEY`, `.env.production` uses `DOTENV_PRIVATE_KEY_PRODUCTION`, and `.env.local` uses `DOTENV_PRIVATE_KEY_LOCAL`. An existing public metadata name takes precedence. Generated filenames must be `.env` or `.env.<environment>`; examples and private key files cannot be encrypted by this command.

During reads, the matching key in the process environment takes precedence over the selected private key file. An explicitly supplied wrong key fails rather than silently falling back. The loader also accepts a `privateKeys` object for callers integrating a trusted secret provider. Missing keys, mismatches, duplicate entries and corrupt ciphertext throw redacted errors. Values are decrypted in memory; loading never writes plaintext back to disk. Public and private key metadata are excluded from application results and examples.

Environment values remain literal. Unlike a general dotenvx runtime configuration call, envRanger does not evaluate `$(commands)`, `${references}`, 1Password/Bitwarden references or cloud custody. This avoids executing code merely because an environment file was loaded. The pinned cryptographic primitives supply the dotenvx ciphertext interoperability.

### Keep edits and routes encrypted

`set` automatically encrypts a new value with the destination's saved public key. It can do this without possessing the private key. `unset` removes an application key while preserving encryption metadata. Neither command lets you overwrite key metadata as an ordinary variable.

`route` decrypts its source in memory. If a destination has a public key, routed values are re-encrypted for that key. Existing destination values require its private key for conflict comparison; `--overwrite` can deliberately replace mapped values using only the recipient public key. Unknown/unmapped destination entries remain untouched.

If the source is encrypted and a destination is plaintext, routing refuses unless you explicitly pass `--plaintext`. This flag does not make a secret safe for frontend use. Keep the route allowlist restricted to values you intentionally permit to be public. `merge` likewise requires `--plaintext` for encrypted sources and refuses to flatten an existing encrypted destination; use `route` for that.

`run` decrypts before starting the child and removes dotenv key metadata from the child's inherited environment. It passes application values, not decryption keys. If your child independently uses a loader, supply its keys through a separate trusted mechanism or let it use its local key file.

### Replace your root loadEnv.js

Copy [`examples/loadEnv.js`](../examples/loadEnv.js) to the **project root**, and adapt [`examples/envranger.config.json`](../examples/envranger.config.json) there. Install envRanger from this GitHub repository first. Your application needs ESM (`"type": "module"` in package.json, or rename the wrapper to `.mjs`). The root is anchored to the wrapper's location, so imports from nested frontend/backend directories do not depend on the current working directory.

The wrapper retains the uploaded file's backend requirements: PORT, MONGODB_URI, NODE_ENV, CLOUDINARY_API_SECRET, CLOUDINARY_API_KEY, CLOUDINARY_CLOUD_NAME, UNSPLASH_ACCESS_KEY, MAPBOX_TOKEN, UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN. Override `required` when your app intentionally uses fewer services.

```js
// backend/server.js — Node.js only
import loadEnv from '../loadEnv.js';
const env = loadEnv();
// The wrapper populates the allowlisted backend keys for legacy process.env consumers.
// It throws on failure; your application decides how to handle startup errors.
```

Core `loadEnv` from `envranger/loader` does not populate process.env by default; only the compatibility wrapper opts in for backend calls. `override: true` lets loaded values replace existing selected process values. Otherwise existing selected process values win. Unrelated process variables are never returned. Failed validation performs no partial injection. There is no global cache: each call rereads files and returns a frozen, newly scoped object.

```js
// Node-side build configuration — never browser application code
import loadEnv from './loadEnv.js';
const publicConfig = loadEnv({ scope: 'frontend' });
// Deliberately pass publicConfig into your framework's build configuration.
// Never serialize a backend or root result into browser code.
```

`access.frontend` and `access.backend` are exact key lists; no prefix is trusted automatically. The example frontend list contains MAPBOX_TOKEN as a demonstration: include it **only if it is a publishable, restricted public Mapbox token**. Remove it or substitute your own public names otherwise. Backend Cloudinary secrets, MongoDB credentials and Redis tokens do not belong in that list. Frameworks may require their own public prefixes or explicit build mapping; this loader does not silently rename keys.

Root access requires both controls:

```json
{ "access": { "frontend": [], "backend": ["PORT"], "root": true } }
```

```js
const allApplicationValues = loadEnv({ scope: 'root', allowRoot: true });
```

If your configuration already lives in separate frontend/backend files, combine them through an explicit profile. Later files win:

```json
{ "profiles": { "complete": ["frontend/.env.local", "backend/.env"] } }
```

```js
const complete = loadEnv({ scope: 'root', allowRoot: true, profile: 'complete' });
```

The loader reads each encrypted file using its matching key. It does not search parent directories or collect arbitrary `.env` files implicitly. Use `files` instead of `profile` when a trusted caller supplies an explicit list.

Both opt-ins are deliberate safeguards for trusted Node-side callers, **not an identity or permissions system**. A person or process with read access to the root private key can decrypt all root ciphertext regardless of the selected scope. Do not accept the scope, allowRoot, file paths or key material from an untrusted HTTP request. Do not expose this loader as a public endpoint.

### Give a person scoped access

Use separate ciphertext files and key pairs for different trust groups. The recipient supplies their dotenvx public key; keep it in that destination's encrypted file. You do not need their private key to send updated values.

1. Create a local destination `.env` file containing only the values that person may receive, or create an empty destination for subsequent routing.
2. Encrypt it using `envranger encrypt --env recipient/.env --public-key <recipient-public-key> --write`.
3. Share the resulting encrypted file. The recipient retains their own private key and provides it through their trusted environment or private key store.
4. To grant complete root access, distribute the root private key only through your existing password manager/secret manager to authorized people. envRanger never prints or sends it for you.

Removing someone from a config list does not revoke a private key they already know. Revocation requires rotating the affected secrets and encryption keys and considering previously shared files and Git history. Keep `.env.keys`, secret provider exports and old plaintext backups out of commits. Local scopes cannot replace OS file permissions, deployment access controls or user authentication.
