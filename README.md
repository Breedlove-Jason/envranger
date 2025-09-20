# Envranger

A stylish CLI to **scan, validate, and manage** `.env` files across your Node/TS projects.

## Highlights
- 🔍 Scans your codebase for `process.env.*` usage
- ✅ Validates loaded env against discovered keys (+ optional `required` config)
- 🧪 Generates `env.d.ts` types for safe `process.env` access
- 🧩 Keeps `.env.example` in sync
- ✏️ Get/Set/Unset variables (`.env` default, configurable)
- 🔐 Works with `@dotenvx/dotenvx` (supports `.env.vault` and `DOTENV_KEY`)
- 🖼️ Pretty terminal UI out-of-the-box

## Quick Start
```bash
npm i -D envranger
npx envranger scan
npx envranger check --strict
npx envranger example
npx envranger types
npx envranger set API_URL=https://example.com
npx envranger get API_URL
npx envranger unset API_URL
```

## Config
Create `envranger.config.mjs` at your project root:

```js
/** @type {import('envranger').Config} */
export default {
  scanDirs: ["src", "app", "server", "scripts"],
  ignore: ["**/node_modules/**", "**/.next/**", "**/.loadenv/**"],
  required: ["DATABASE_URL", "NEXT_PUBLIC_APP_URL"],
  optional: ["NEXT_PUBLIC_ANALYTICS_ID"],
  deprecated: [],
  envFile: ".env"
}
```

## CI
Use `envranger check --strict` in CI. See `.github/workflows/ci.yml` in this repo for an example.

## New Commands

- `envranger init` – interactive setup to create `envranger.config.mjs`, optional `envranger.schema.mjs`, run a scan, generate types, and `.env.example`.
- `envranger schema` – validate current env against your Zod schema.
- `envranger merge <dest> <files...> [--override]` – merge multiple `.env*` files into one.
- `envranger vault <subcmd>` – wrappers for dotenvx: `init|view|keys|set|push|pull` (requires `dotenvx` available locally or via `npx`).

### Example vault usage

```bash
envranger vault init              # initialize a vault
envranger vault keys              # show keys
envranger vault set --args --env=.env.production API_URL=https://prod.example.com
envranger vault push              # push .env.* into the vault
envranger vault view              # view vault content
```

### Schema validation

Create `envranger.schema.mjs`:

```js
import { z } from "zod";
export default z.object({
  DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  STRIPE_SECRET_KEY: z.string().min(20),
}).catchall(z.string());
```

Then run:

```bash
envranger schema --strict
```

If invalid, the command prints issues and exits non‑zero in `--strict` mode.


## Polishing & Integration

### One-liner setup in an app
```bash
npx envranger init
npm i -D husky lint-staged
npx husky install
npx envranger integrate next
git add . && git commit -m "chore: envranger integration"
```

### Recommended scripts in your app's package.json
```json
{
  "scripts": {
    "env:scan": "envranger scan",
    "env:check": "envranger check --strict --report",
    "env:types": "envranger types",
    "env:doctor": "envranger doctor --strict"
  }
}
```

### Pre-commit
- Runs `envranger check` on `.env*` to prevent bad env from landing in Git.
- Regenerates `env.d.ts` automatically so TypeScript stays happy.

### CI
Use `envranger doctor --strict` for fast feedback; PRs get a comment with the full report.

### Cool extras
- `envranger rename --from FOO --to BAR --dry-run` to preview a safe rename across code & env files.
- `envranger report` writes both `report.md` and `report.json` for dashboards.
- `envranger schema --strict` to enforce Zod validation rules (edit `envranger.schema.mjs`).



## New Neon TUI
```bash
envranger wizard
# Optional one-off set from the shell:
ENVRANGER_PAIR=API_URL=https://example.com envranger wizard
```

## .env Linter/Fixer
```bash
envranger lint --file .env         # report only
envranger lint --file .env --fix   # write normalized file
envranger lint --file .env --fix --sort  # also sort keys
```

## Presets
```bash
envranger presets list
envranger presets apply "Stripe"
```
Presets are also available in the wizard.

## Gated CI (opt-in)
A separate workflow at `.github/workflows/ci-gated.yml` runs `doctor --strict` and **fails** on problems. Trigger it manually with **Run workflow** in GitHub (or add `push/pull_request` triggers to make it always-on).

## Multi-framework support
Use `envranger integrate next` for Next.js apps or `envranger integrate node` for generic Node/Express/TS projects. The core scanner works with **any** JS/TS codebase—tune `scanDirs` in your config.
