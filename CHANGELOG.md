# Changelog

## 0.3.0 — 2026-09-22

- Add pinned dotenvx dependencies and official encryption primitives.
- Preserve public metadata, save generated private keys separately, and decrypt in memory without evaluating shell substitutions.
- Encrypt edits and routes to encrypted destinations; require explicit plaintext export consent.
- Add recipient public-key encryption and public metadata inspection.
- Add `envranger/loader` with explicit frontend/backend projections and two root opt-ins.
- Replace the uploaded loader's global process cache and process termination with frozen results and caller-controlled errors.
- Include the fixed root loader, original backend requirement list, example access/routing config, and sharing guidance.

## 0.2.0 — 2026-09-21

Rebuild the original experimental CLI into a documented local environment workflow.

- Add AST-based static JS/TS discovery, explicit file profiles and key routing.
- Make environment mutations preview by default, with private backups and atomic per-file replacement.
- Add literal multiline parsing, masked inspection, stdin edits, provenance and keys-only reports.
- Add child process execution with explicit precedence and exit propagation.
- Validate selected files without inheriting unrelated shell variables.
- Replace executable configuration with declarative JSON and document breaking migrations.
- Remove unsupported experimental wizard, presets, vault, rename and hook installers.
- Add Linux/Windows CI, packaged CLI checks, a complete user guide and public project website.

This version is distributed from GitHub source. No npm registry publication is claimed.
