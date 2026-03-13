# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## IMPORTANT: Public Repository

This is a public repo. Never commit secrets, API keys, tokens, internal URLs,
endpoints, or any sensitive information. All secrets must be passed via GitHub
Actions secrets and referenced as input variables. Always review changes before
committing to ensure nothing sensitive is leaked.

## What This Is

A collection of GitHub Actions (JavaScript) for a demo workflow that fetches
emails from SxT (Space and Time), decodes them, and summarizes them with an AI
model via Hyperbolic.

Two actions:

- **`http`** — Generic HTTP request action with explicit encryption controls
  (`decrypt-inputs`, `extract-outputs`, `encrypt-outputs`).
- **`base64-decode`** — Decodes base64url-encoded fields in JSON array data.

## Commands

```bash
npm ci                  # Install dependencies (use this, not npm install)
npm test                # Run tests (Jest with ESM via --experimental-vm-modules)
npm run lint            # ESLint
npm run format:check    # Prettier check
npm run format:write    # Prettier fix
npm run package         # Bundle src/ into http/dist/ and base64-decode/dist/ via Rollup
npm run bundle          # Format + package
npm run all             # Format + lint + test + coverage badge + package
```

## Architecture

- **ES Modules** throughout (`"type": "module"` in package.json). Node >= 20
  required (.node-version: 24.4.0).
- **`src/http/main.js`** — HTTP action core logic exported as `run()`. Uses
  `@actions/core` for inputs/outputs. Supports `decrypt-inputs` (path-based
  decryption), `extract-outputs` (dot-notation field extraction),
  `encrypt-outputs` (selective encryption).
- **`src/http/index.js`** — Entrypoint that calls `run()`.
- **`src/base64-decode/main.js`** — Base64 decode action logic. Decodes
  base64url fields, supports select-keys extraction and output filtering.
- **`src/base64-decode/index.js`** — Entrypoint that calls `run()`.
- **`src/crypto.js`** — Shared AES-256-GCM encryption module. Exports
  `encryptValue`, `decryptValue`, `tryDecrypt`, `createEncryptedOutput`.
- **`scripts/decrypt.js`** — Standalone CLI helper for shell steps to decrypt
  encrypted values. Inlines crypto logic (does not import from src/crypto.js).
- **`http/dist/index.js`** and **`base64-decode/dist/index.js`** — Rollup-bundled
  outputs (committed to repo). Each action runs its own dist file. **Must be
  rebuilt (`npm run package`) after any source change.**
- **`http/action.yml`** — HTTP action metadata. Key inputs: `url`, `method`,
  `headers`, `body`, `decrypt-inputs`, `extract-outputs`, `encrypt-outputs`,
  `encryption-key`. Outputs: `success`, `status-code`, `response`.
- **`base64-decode/action.yml`** — Base64 decode action metadata.

## Testing

Tests use Jest 30 with ESM support. Mocking pattern:

- **`__fixtures__/core.js`** — Manual mock module for `@actions/core`.
- Tests use `jest.unstable_mockModule()` with top-level `await import()` to mock
  ESM dependencies (not `jest.mock()`).

## CI

CI runs on PRs and pushes to `main`: format check → lint → test. A separate job
tests the action itself by running it with `uses: ./`.

## Important Workflow

After changing source code: run `npm run package` to rebuild dist bundles,
then commit the updated dist files. CI has a `check-dist` workflow that verifies
dist is up to date.
