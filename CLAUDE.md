# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## IMPORTANT: Public Repository

This is a public repo. Never commit secrets, API keys, tokens, internal URLs,
endpoints, or any sensitive information. All secrets must be passed via GitHub
Actions secrets and referenced as input variables. Always review changes before
committing to ensure nothing sensitive is leaked.

## What This Is

A GitHub Action (JavaScript) that fetches SXT auth via a shared secret. Based on
the hyperbolic-demo template.

## Commands

```bash
npm ci                  # Install dependencies (use this, not npm install)
npm test                # Run tests (Jest with ESM via --experimental-vm-modules)
npm run lint            # ESLint
npm run format:check    # Prettier check
npm run format:write    # Prettier fix
npm run package         # Bundle src/ into dist/index.js via Rollup
npm run bundle          # Format + package
npm run all             # Format + lint + test + coverage badge + package
```

## Architecture

- **ES Modules** throughout (`"type": "module"` in package.json). Node >= 20
  required (.node-version: 24.4.0).
- **`src/main.js`** — Core logic exported as `run()`. Uses `@actions/core` for
  inputs/outputs and `@actions/github` for context.
- **`src/index.js`** — Entrypoint that calls `run()`.
- **`dist/index.js`** — Rollup-bundled output (committed to repo). The action
  runs this file (`action.yml` → `runs.main: dist/index.js`). **Must be rebuilt
  (`npm run package`) after any source change.**
- **`action.yml`** — Action metadata. Inputs: `sxt_auth_secret`,
  `sxt_endpoint_url`. Output: `sxt-auth`. Runtime: `node24`.

## Testing

Tests use Jest 30 with ESM support. Mocking pattern:

- **`__fixtures__/core.js`** and **`__fixtures__/github.js`** — Manual mock
  modules for `@actions/core` and `@actions/github`.
- Tests use `jest.unstable_mockModule()` with top-level `await import()` to mock
  ESM dependencies (not `jest.mock()`).

## CI

CI runs on PRs and pushes to `main`: format check → lint → test. A separate job
tests the action itself by running it with `uses: ./`.

## Important Workflow

After changing source code: run `npm run package` to rebuild `dist/index.js`,
then commit the updated dist. CI has a `check-dist` workflow that verifies dist
is up to date.
