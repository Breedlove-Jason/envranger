# Envranger • Scan, validate, and manage your .env like a pro

A stylish CLI for Node/JS/TS projects to **scan** `process.env.*` usage, **validate** your environment, **generate types**, **lint/fix** `.env` files, and **manage** keys—with optional Zod validation and dotenvx vault helpers. Neon TUI wizard included.

> Works with **any** JS/TS project (Next.js, Node/Express, Nest, scripts, etc.). Framework-agnostic.

---

## ✨ Features

- 🔍 **Scan** code for `process.env.X` references (`scan`)
- ✅ **Check** loaded env vs. discovered keys + required/optional/deprecated (`check`)
- 🧪 **Types** generator for `process.env` (`types`)
- 🧩 **.env.example** sync (`example`)
- ✏️ **Set/Get/Unset** values safely (`set`, `get`, `unset`)
- 🧹 **Lint/Fix** `.env` files preserving comments (`lint`)
- 🧱 **Zod schema validation** (`schema`)
- 🔐 **dotenvx vault helpers** (`vault`)
- 🧬 **Presets**: Stripe, S3, Next Public, Postgres (`presets`, wizard)
- 🧠 **Doctor**: all-in-one health check (`doctor`)
- 🧰 **Rename** keys across code + env files (`rename`)
- 🧯 **Merge** env files (`merge`)
- 🖥️ **Neon TUI Wizard** (`wizard`)
- 🧩 **Integrate** into Next.js or generic Node projects in seconds (`integrate next|node`)
- 🧳 **Compat** import for older codebases (drop-in for `loadEnv.mjs`)

---

## 🚀 Install

```bash
# Local dev in the envranger repo
npm i
npm run build
npm link   # optional, lets you run `envranger` globally

# In any project (after you publish to npm):
npm i -D @breedlove/envranger
npx envranger init
