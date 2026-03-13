# HTTP Action Encryption Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace implicit auto-decrypt/encrypt with explicit `decrypt-inputs`, `extract-outputs`, and `encrypt-outputs` inputs on the http action, and add a `scripts/decrypt.js` CLI helper for shell steps.

**Architecture:** The http action gets three new inputs that explicitly control encryption. `decrypt-inputs` uses dot-notation paths (e.g., `headers.sid`) to decrypt specific values in-place before making the request. `extract-outputs` replaces `response-fields` for pulling fields from JSON responses. `encrypt-outputs` selectively encrypts listed outputs. A `scripts/decrypt.js` helper handles decryption in shell steps. The decrypt action is deleted.

**Tech Stack:** Node.js 24, ES Modules, Jest 30, Rollup, `@actions/core`, native `crypto` module.

---

### Task 1: Clean up crypto.js — remove getInput and decryptHeaders

**Files:**
- Modify: `src/crypto.js:77-114` (remove `getInput` and `decryptHeaders`)
- Modify: `__tests__/crypto.test.js` (remove tests for `getInput`, `decryptHeaders`, `tryDecrypt`)
- Test: `__tests__/crypto.test.js`

**Step 1: Remove `getInput` and `decryptHeaders` from crypto.js**

Delete lines 77–114 from `src/crypto.js` (the `getInput` and `decryptHeaders` functions). Keep `encryptValue`, `decryptValue`, `createEncryptedOutput`, `tryDecrypt`.

**Step 2: Remove their tests from crypto.test.js**

Remove the `describe('getInput', ...)` and `describe('decryptHeaders', ...)` blocks. Keep `describe('tryDecrypt', ...)` — it's still used.

**Step 3: Remove the imports of deleted functions**

Update the import in `__tests__/crypto.test.js` to remove `getInput` and `decryptHeaders`.

**Step 4: Run tests**

Run: `npm test -- --testPathPattern=crypto`
Expected: All remaining crypto tests pass.

**Step 5: Commit**

```bash
git add src/crypto.js __tests__/crypto.test.js
git commit -m "refactor: remove getInput and decryptHeaders from crypto module"
```

---

### Task 2: Add decryptInputs helper to http action

**Files:**
- Modify: `src/http/main.js`
- Test: `__tests__/http.test.js`

**Step 1: Write the failing tests**

Add these tests to `__tests__/http.test.js`:

```javascript
it('decrypts value at decrypt-inputs path in headers', async () => {
  const { encryptValue } = await import('../src/crypto.js')
  const encrypted = encryptValue('my-session-id', 'test-key')
  core.getInput.mockImplementation((name) => {
    const inputs = {
      url: 'https://example.com/api',
      method: 'GET',
      headers: `{"sid": "${encrypted}", "Content-Type": "application/json"}`,
      'decrypt-inputs': 'headers.sid',
      'encryption-key': 'test-key'
    }
    return inputs[name] || ''
  })
  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => '{"ok": true}'
  })

  await run()

  const fetchCall = global.fetch.mock.calls[0]
  expect(fetchCall[1].headers.sid).toBe('my-session-id')
  expect(fetchCall[1].headers['Content-Type']).toBe('application/json')
})

it('decrypts Bearer token in Authorization header', async () => {
  const { encryptValue } = await import('../src/crypto.js')
  const encrypted = encryptValue('my-token', 'test-key')
  core.getInput.mockImplementation((name) => {
    const inputs = {
      url: 'https://example.com/api',
      method: 'POST',
      headers: `{"Authorization": "Bearer ${encrypted}"}`,
      body: '{}',
      'decrypt-inputs': 'headers.Authorization',
      'encryption-key': 'test-key'
    }
    return inputs[name] || ''
  })
  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => '{"ok": true}'
  })

  await run()

  const fetchCall = global.fetch.mock.calls[0]
  expect(fetchCall[1].headers.Authorization).toBe('Bearer my-token')
})

it('decrypts nested path in body', async () => {
  const { encryptValue } = await import('../src/crypto.js')
  const encrypted = encryptValue('secret-value', 'test-key')
  core.getInput.mockImplementation((name) => {
    const inputs = {
      url: 'https://example.com/api',
      method: 'POST',
      headers: '{"Content-Type": "application/json"}',
      body: `{"auth": {"token": "${encrypted}"}}`,
      'decrypt-inputs': 'body.auth.token',
      'encryption-key': 'test-key'
    }
    return inputs[name] || ''
  })
  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => '{"ok": true}'
  })

  await run()

  const fetchCall = global.fetch.mock.calls[0]
  const sentBody = JSON.parse(fetchCall[1].body)
  expect(sentBody.auth.token).toBe('secret-value')
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=http`
Expected: FAIL — new tests fail because `decrypt-inputs` is not implemented.

**Step 3: Implement decryptInputs in http action**

Replace the current header/body reading in `src/http/main.js`. Remove imports of `getInput` and `decryptHeaders`. Add a `decryptAtPath` helper and the `decrypt-inputs` parsing logic:

```javascript
import * as core from '@actions/core'
import { tryDecrypt } from '../crypto.js'
import {
  decodeBase64Url,
  parseSelectKeys,
  extractKeys
} from '../base64-decode/main.js'

function decryptAtPath(obj, pathParts, encryptionKey) {
  let current = obj
  for (let i = 0; i < pathParts.length - 1; i++) {
    if (current[pathParts[i]] === undefined) return obj
    current = current[pathParts[i]]
  }
  const lastKey = pathParts[pathParts.length - 1]
  const value = current[lastKey]
  if (typeof value !== 'string') return obj

  // Handle Bearer prefix
  if (value.startsWith('Bearer ')) {
    const token = value.slice(7)
    const decrypted = tryDecrypt(token, encryptionKey)
    if (decrypted !== null) {
      current[lastKey] = `Bearer ${decrypted}`
    }
    return obj
  }

  const decrypted = tryDecrypt(value, encryptionKey)
  if (decrypted !== null) {
    current[lastKey] = decrypted
  }
  return obj
}

export async function run() {
  try {
    const encryptionKey = core.getInput('encryption-key')

    const url = core.getInput('url', { required: true })
    const method = core.getInput('method') || 'POST'
    const headersRaw = core.getInput('headers') || '{}'
    const bodyRaw = core.getInput('body')

    // Parse mutable copies
    const inputStore = {
      headers: JSON.parse(headersRaw),
      body: bodyRaw
    }

    // Try parsing body as JSON for path-based decryption
    let bodyIsJson = false
    try {
      if (bodyRaw) {
        inputStore.body = JSON.parse(bodyRaw)
        bodyIsJson = true
      }
    } catch {
      // body is not JSON, leave as string
    }

    // decrypt-inputs: path-based decryption
    const decryptInputs = core.getInput('decrypt-inputs')
    if (decryptInputs && encryptionKey) {
      for (const path of decryptInputs.split(',').map((p) => p.trim())) {
        const parts = path.split('.')
        const inputName = parts[0]
        const fieldParts = parts.slice(1)
        if (inputStore[inputName] !== undefined && fieldParts.length > 0) {
          decryptAtPath(inputStore[inputName], fieldParts, encryptionKey)
        }
      }
    }

    const headers = inputStore.headers
    const body = bodyIsJson ? JSON.stringify(inputStore.body) : inputStore.body

    // ... rest of the function uses headers and body
```

The full `run()` function continues with the existing fetch + post-processing logic, but using `headers` and `body` from above instead of the old `getInput`/`decryptHeaders` calls.

**Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=http`
Expected: All tests pass including the new decrypt-inputs tests.

**Step 5: Commit**

```bash
git add src/http/main.js __tests__/http.test.js
git commit -m "feat: add decrypt-inputs path-based decryption to http action"
```

---

### Task 3: Add extract-outputs and encrypt-outputs to http action

**Files:**
- Modify: `src/http/main.js`
- Test: `__tests__/http.test.js`

**Step 1: Write the failing tests**

```javascript
it('extracts fields via extract-outputs and does not output full response', async () => {
  core.getInput.mockImplementation((name) => {
    const inputs = {
      url: 'https://example.com/api',
      method: 'POST',
      headers: '{}',
      body: '{}',
      'extract-outputs': 'sessionId,accessToken'
    }
    return inputs[name] || ''
  })
  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => '{"sessionId": "abc", "accessToken": "xyz", "extra": "ignored"}'
  })

  await run()

  expect(core.setOutput).toHaveBeenCalledWith('sessionId', 'abc')
  expect(core.setOutput).toHaveBeenCalledWith('accessToken', 'xyz')
  expect(core.setOutput).toHaveBeenCalledWith('success', 'true')
  expect(core.setOutput).toHaveBeenCalledWith('status-code', '200')
  // No full response output
  const responseCall = core.setOutput.mock.calls.find((c) => c[0] === 'response')
  expect(responseCall).toBeUndefined()
})

it('extracts nested fields via dot notation', async () => {
  core.getInput.mockImplementation((name) => {
    const inputs = {
      url: 'https://example.com/api',
      method: 'POST',
      headers: '{}',
      body: '{}',
      'extract-outputs': 'data.auth.sessionId'
    }
    return inputs[name] || ''
  })
  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => '{"data": {"auth": {"sessionId": "deep-value"}}}'
  })

  await run()

  expect(core.setOutput).toHaveBeenCalledWith('sessionId', 'deep-value')
})

it('encrypts only outputs listed in encrypt-outputs', async () => {
  const { decryptValue } = await import('../src/crypto.js')
  core.getInput.mockImplementation((name) => {
    const inputs = {
      url: 'https://example.com/api',
      method: 'POST',
      headers: '{}',
      body: '{}',
      'extract-outputs': 'sessionId,accessToken',
      'encrypt-outputs': 'sessionId',
      'encryption-key': 'test-key'
    }
    return inputs[name] || ''
  })
  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => '{"sessionId": "secret", "accessToken": "public"}'
  })

  await run()

  // sessionId should be encrypted
  const sessionCall = core.setOutput.mock.calls.find((c) => c[0] === 'sessionId')
  expect(sessionCall[1]).not.toBe('secret')
  expect(decryptValue(sessionCall[1], 'test-key')).toBe('secret')

  // accessToken should be plaintext
  expect(core.setOutput).toHaveBeenCalledWith('accessToken', 'public')
})

it('encrypts full response when listed in encrypt-outputs', async () => {
  const { decryptValue } = await import('../src/crypto.js')
  core.getInput.mockImplementation((name) => {
    const inputs = {
      url: 'https://example.com/api',
      method: 'POST',
      headers: '{}',
      body: '{}',
      'encrypt-outputs': 'response',
      'encryption-key': 'test-key'
    }
    return inputs[name] || ''
  })
  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => '{"data": "sensitive"}'
  })

  await run()

  const responseCall = core.setOutput.mock.calls.find((c) => c[0] === 'response')
  expect(responseCall[1]).not.toBe('{"data": "sensitive"}')
  expect(decryptValue(responseCall[1], 'test-key')).toBe('{"data": "sensitive"}')
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=http`
Expected: FAIL — new tests fail.

**Step 3: Implement extract-outputs, encrypt-outputs, success, status-code**

In `src/http/main.js`, replace the output section. The key changes:
- Replace `setEncryptedOutput` (which always encrypts when key is set) with selective encryption based on `encrypt-outputs` list.
- Replace `response-fields` block with `extract-outputs` logic supporting dot notation.
- Output `success` and `status-code` instead of `status` and `encrypted`.
- Move `core.setFailed()` after setting outputs so `success`/`status-code` are always set.

Helper for extracting nested values:

```javascript
function getNestedValue(obj, path) {
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current === undefined || current === null) return undefined
    current = current[part]
  }
  return current
}
```

Output logic:

```javascript
    core.setOutput('success', response.ok ? 'true' : 'false')
    core.setOutput('status-code', response.status.toString())

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseBody}`)
    }

    const extractOutputs = core.getInput('extract-outputs')
    const encryptOutputsList = core.getInput('encrypt-outputs')
    const fieldsToEncrypt = encryptOutputsList
      ? encryptOutputsList.split(',').map((f) => f.trim())
      : []

    function setOutput(name, value) {
      if (fieldsToEncrypt.includes(name) && encryptionKey) {
        core.setOutput(name, encryptValue(value, encryptionKey))
      } else {
        core.setOutput(name, value)
      }
    }

    if (extractOutputs) {
      const parsed = JSON.parse(responseBody)
      for (const fieldPath of extractOutputs.split(',').map((f) => f.trim())) {
        const value = getNestedValue(parsed, fieldPath)
        if (value !== undefined) {
          const leafName = fieldPath.split('.').pop()
          const strValue = typeof value === 'string' ? value : JSON.stringify(value)
          setOutput(leafName, strValue)
        }
      }
    }

    // Post-processing pipeline (unchanged) ...

    if (!extractOutputs) {
      setOutput('response', processedOutput)
    }
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=http`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/http/main.js __tests__/http.test.js
git commit -m "feat: add extract-outputs, encrypt-outputs, success, status-code to http action"
```

---

### Task 4: Update existing http tests for new output names

**Files:**
- Modify: `__tests__/http.test.js`

**Step 1: Update existing tests**

The existing tests reference `status` and `encrypted` outputs which no longer exist. Update them:

- `expect(core.setOutput).toHaveBeenCalledWith('status', '200')` → `expect(core.setOutput).toHaveBeenCalledWith('status-code', '200')`
- `expect(core.setOutput).toHaveBeenCalledWith('status', '500')` → `expect(core.setOutput).toHaveBeenCalledWith('status-code', '500')`
- Remove all `expect(core.setOutput).toHaveBeenCalledWith('encrypted', ...)` assertions.
- Add `expect(core.setOutput).toHaveBeenCalledWith('success', 'true')` / `'false'` where appropriate.
- Remove the `'extracts response-fields as separate outputs'` test (replaced by extract-outputs test in Task 3).
- Update the `'encrypts response when encryption-key is provided'` test to use `encrypt-outputs: 'response'` instead of relying on auto-encrypt.

**Step 2: Run tests**

Run: `npm test -- --testPathPattern=http`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add __tests__/http.test.js
git commit -m "test: update http tests for new output names"
```

---

### Task 5: Update http action.yml

**Files:**
- Modify: `http/action.yml`

**Step 1: Update action.yml**

Replace the inputs/outputs to match the new interface:

```yaml
name: HTTP Request
description: Make an HTTP request and return the response
author: GitHub Actions

inputs:
  url:
    description: Request URL
    required: true
  method:
    description: HTTP method
    required: false
    default: POST
  headers:
    description: JSON string of request headers
    required: false
    default: '{}'
  body:
    description: Request body string
    required: false
    default: ''
  decode-fields:
    description: Base64url-decode these fields in JSON array response
    required: false
  output-fields:
    description: Keep only these fields in the output (comma-separated)
    required: false
  select-keys:
    description: >-
      Extract keys from decoded JSON arrays of {name, value} objects.
      Format: FIELD:key1,key2;FIELD2:key3
    required: false
  limit:
    description: Limit number of rows in JSON array response (0 for no limit)
    required: false
    default: '0'
  extract-outputs:
    description: >-
      Comma-separated field names to extract from JSON response as separate
      outputs. Supports dot notation (e.g., data.auth.sessionId). When set,
      the full response output is not returned.
    required: false
  encrypt-outputs:
    description: >-
      Comma-separated output names to encrypt with AES-256-GCM.
    required: false
  decrypt-inputs:
    description: >-
      Comma-separated input.field dot-notation paths to decrypt in-place.
      Example: headers.sid,headers.Authorization. Bearer token pattern
      is auto-detected on Authorization headers.
    required: false
  encryption-key:
    description: AES-256-GCM key for encrypt/decrypt operations
    required: false

outputs:
  success:
    description: Whether the HTTP request succeeded (true/false)
  status-code:
    description: HTTP status code
  response:
    description: >-
      Response body (only when extract-outputs is not set).
      Encrypted if listed in encrypt-outputs.

runs:
  using: node24
  main: dist/index.js
```

**Step 2: Commit**

```bash
git add http/action.yml
git commit -m "docs: update http action.yml with new encryption interface"
```

---

### Task 6: Create scripts/decrypt.js CLI helper

**Files:**
- Create: `scripts/decrypt.js`
- Test: `__tests__/decrypt-script.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'child_process'
import { encryptValue } from '../src/crypto.js'

describe('scripts/decrypt.js', () => {
  const key = 'test-key'

  it('decrypts a raw encrypted value', () => {
    const encrypted = encryptValue('hello-world', key)
    const result = execFileSync('node', ['scripts/decrypt.js', key, encrypted], {
      encoding: 'utf-8'
    }).trim()
    expect(result).toBe('hello-world')
  })

  it('decrypts and extracts a field from encrypted JSON', () => {
    const json = JSON.stringify({ sessionId: 'abc123', extra: 'ignored' })
    const encrypted = encryptValue(json, key)
    const result = execFileSync(
      'node',
      ['scripts/decrypt.js', key, encrypted, 'sessionId'],
      { encoding: 'utf-8' }
    ).trim()
    expect(result).toBe('abc123')
  })

  it('exits with error on invalid encrypted value', () => {
    expect(() => {
      execFileSync('node', ['scripts/decrypt.js', key, 'not-encrypted'], {
        encoding: 'utf-8'
      })
    }).toThrow()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=decrypt-script`
Expected: FAIL — `scripts/decrypt.js` does not exist.

**Step 3: Create scripts/decrypt.js**

```javascript
#!/usr/bin/env node
import { createDecipheriv, createHash } from 'crypto'

const [, , key, encrypted, field] = process.argv

if (!key || !encrypted) {
  console.error('Usage: decrypt.js <key> <encrypted> [field]')
  process.exit(1)
}

try {
  const keyHash = createHash('sha256').update(key).digest()
  const buf = Buffer.from(encrypted, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', keyHash, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf-8')

  if (field) {
    const parsed = JSON.parse(decrypted)
    const value = parsed[field]
    if (value === undefined) {
      console.error(`Field '${field}' not found`)
      process.exit(1)
    }
    process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value))
  } else {
    process.stdout.write(decrypted)
  }
} catch (err) {
  console.error(`Decryption failed: ${err.message}`)
  process.exit(1)
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=decrypt-script`
Expected: All pass.

**Step 5: Commit**

```bash
git add scripts/decrypt.js __tests__/decrypt-script.test.js
git commit -m "feat: add scripts/decrypt.js CLI helper for shell steps"
```

---

### Task 7: Delete decrypt action and clean up build config

**Files:**
- Delete: `decrypt/action.yml`, `decrypt/dist/` (if exists)
- Delete: `src/decrypt/main.js`, `src/decrypt/index.js`
- Modify: `rollup.config.js`
- Modify: `package.json`
- Modify: `.gitattributes`

**Step 1: Delete decrypt action files**

```bash
rm -rf decrypt/ src/decrypt/
```

**Step 2: Remove decrypt entry from rollup.config.js**

Remove the line `entry('src/decrypt/index.js', 'decrypt/dist/index.js')` from the config array.

**Step 3: Remove decrypt from package.json package script**

Change `"package": "npx rimraf ./http/dist ./base64-decode/dist ./decrypt/dist && ..."` to `"package": "npx rimraf ./http/dist ./base64-decode/dist && ..."`.

**Step 4: Remove decrypt from .gitattributes**

Remove the line `decrypt/dist/** -diff linguist-generated=true`.

**Step 5: Run build to verify**

Run: `npm run package`
Expected: Builds http and base64-decode bundles without errors. No decrypt bundle.

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: delete decrypt action and clean up build config"
```

---

### Task 8: Update base64-decode action to remove getInput

**Files:**
- Modify: `src/base64-decode/main.js`
- Test: `__tests__/base64-decode.test.js`

**Step 1: Replace getInput with core.getInput in base64-decode**

In `src/base64-decode/main.js`, change:
- `import { createEncryptedOutput, getInput } from '../crypto.js'` → `import { createEncryptedOutput } from '../crypto.js'`
- `const input = getInput(core, encryptionKey, 'input')` → `const input = core.getInput('input')`

**Step 2: Run tests**

Run: `npm test -- --testPathPattern=base64-decode`
Expected: All tests pass unchanged (tests were not using encrypted inputs).

**Step 3: Commit**

```bash
git add src/base64-decode/main.js
git commit -m "refactor: remove auto-decrypt from base64-decode action"
```

---

### Task 9: Update workflow to use new interface

**Files:**
- Modify: `.github/workflows/demo-gha-containerization.yml`

**Step 1: Rewrite the workflow**

Key changes:
- Add job-level `env: ENCRYPTION_KEY` on both jobs.
- Login step: `extract-outputs: 'sessionId,accessToken'`, `encrypt-outputs: 'sessionId,accessToken'`, remove `response-fields`.
- Biscuit step: `decrypt-inputs: 'headers.sid'`, `extract-outputs: 'biscuit'`, `encrypt-outputs: 'biscuit'`, remove `response-fields`.
- Remove separate decrypt steps (decrypt-biscuit, decrypt-query, decrypt-primary, decrypt-fallback).
- Build query step: Use `node scripts/decrypt.js` for biscuit. Add checkout step before it so `scripts/decrypt.js` is available.
- Query step: `decrypt-inputs: 'headers.Authorization'`, `encrypt-outputs: 'response'`, remove `encryption-key` from encrypt-all behavior.
- Format step: Use `node scripts/decrypt.js` for query response.
- Summarize job: Primary/fallback use `encrypt-outputs: 'response'`. Log output step uses `node scripts/decrypt.js`.
- Add `actions/checkout@v4` step at the start of each job (needed for `scripts/decrypt.js`).

**Step 2: Verify YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/demo-gha-containerization.yml'))"`
Expected: No errors.

**Step 3: Commit**

```bash
git add .github/workflows/demo-gha-containerization.yml
git commit -m "feat: update workflow to use new encryption interface"
```

---

### Task 10: Remove unused @actions/github, rebuild, final verification

**Files:**
- Modify: `package.json`

**Step 1: Remove @actions/github dependency**

It's already been removed in an earlier uncommitted edit. Verify it's gone from `package.json`.

**Step 2: Run npm ci to update lockfile**

Run: `npm ci`

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 4: Rebuild dist bundles**

Run: `npm run package`
Expected: `http/dist/index.js` and `base64-decode/dist/index.js` rebuilt. No decrypt dist.

**Step 5: Verify outputs**

Run: `ls http/dist/index.js base64-decode/dist/index.js`
Expected: Both files exist.

**Step 6: Commit everything**

```bash
git add -A
git commit -m "chore: remove unused dependency, rebuild dist bundles"
```
