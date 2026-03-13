# HTTP Action Encryption Redesign

## Problem

The current encryption implementation has too many implicit behaviors
(`getInput` auto-decrypt, `decryptHeaders`, `response-fields`) that are hard to
reason about. This is a public repo — sensitive data must never appear as
plaintext in any step output. We need an explicit, intentional approach to
encryption/decryption.

## Design

### HTTP Action Inputs

Existing inputs unchanged: `url`, `method`, `headers`, `body`, `decode-fields`,
`output-fields`, `select-keys`, `limit`.

New/renamed inputs:

| Input | Description |
| --- | --- |
| `extract-outputs` | Comma-separated field names to extract from the JSON response as separate outputs. Supports dot notation for nested fields (e.g., `data.auth.sessionId` extracts the value and outputs it as `sessionId`). When set, the full `response` output is not returned. |
| `encrypt-outputs` | Comma-separated output names to encrypt with AES-256-GCM. Only the listed outputs are encrypted. |
| `decrypt-inputs` | Comma-separated `input.field` dot-notation paths to decrypt in-place before using. The action navigates the input (parsed as JSON), decrypts the value at the specified path, and replaces it. Special case: `Bearer <token>` pattern on Authorization headers — only the token part is decrypted. |
| `encryption-key` | AES-256-GCM key used for all encrypt/decrypt operations. |

Removed inputs:

- `response-fields` (replaced by `extract-outputs`)

### HTTP Action Outputs

| Output | Description |
| --- | --- |
| `success` | `true` if HTTP response is 2xx, `false` otherwise. Action still calls `core.setFailed()` on error. |
| `status-code` | HTTP status code (e.g., `200`, `404`, `500`). |
| `response` | Full response body. Only present when `extract-outputs` is NOT set. Encrypted if listed in `encrypt-outputs`. |
| `<field>` | Extracted field values when `extract-outputs` is set. Encrypted if listed in `encrypt-outputs`. |

Removed outputs:

- `encrypted` (no longer needed — the workflow author knows which outputs they
  encrypted via `encrypt-outputs`)
- `status` (renamed to `status-code`)

### decrypt-inputs Behavior

Given `decrypt-inputs: 'headers.sid,headers.Authorization'`:

1. Parse `headers` input as JSON.
2. Navigate to `.sid`, call `tryDecrypt()`, replace with decrypted value.
3. Navigate to `.Authorization`:
   - If value starts with `Bearer `, decrypt only the token part and
     reconstruct `Bearer <decrypted>`.
   - Otherwise, decrypt the whole value.
4. Use the modified headers for the HTTP request.

Values that fail decryption are left as-is (not encrypted or wrong key).

### extract-outputs Behavior

Given `extract-outputs: 'sessionId,data.auth.token'`:

1. Parse response body as JSON.
2. Extract `response.sessionId` → output name: `sessionId`.
3. Extract `response.data.auth.token` → output name: `token` (leaf name).
4. If listed in `encrypt-outputs`, encrypt the value before setting output.
5. Do NOT set the full `response` output.

### scripts/decrypt.js

A small CLI helper for shell steps that need to consume encrypted values. The
decrypted plaintext only exists in the shell process memory — never in a step
output.

```bash
# Decrypt a raw encrypted value
VALUE=$(node scripts/decrypt.js "$ENCRYPTION_KEY" "$ENCRYPTED_BLOB")

# Decrypt and extract a field from an encrypted JSON blob
SESSION=$(node scripts/decrypt.js "$ENCRYPTION_KEY" "$ENCRYPTED_BLOB" "sessionId")
```

### Workflow Example

```yaml
jobs:
  fetch-emails:
    env:
      ENCRYPTION_KEY: ${{ secrets.W3_SECRET_DEMO_ENCRYPTION_KEY }}
    steps:
      - name: Login
        id: login
        uses: w3-io/demo-gha-containerization-1/http@main
        with:
          url: https://proxy.api.makeinfinite.dev/auth/login
          method: POST
          headers: '{"Content-Type": "application/json"}'
          body: >-
            {"userId": "${{ secrets.W3_SECRET_DEMO_SXT_USER_ID }}",
             "password": "${{ secrets.W3_SECRET_DEMO_SXT_PASSWORD }}"}
          extract-outputs: 'sessionId,accessToken'
          encrypt-outputs: 'sessionId,accessToken'
          encryption-key: ${{ env.ENCRYPTION_KEY }}

      - name: Fetch Biscuit
        id: biscuit
        uses: w3-io/demo-gha-containerization-1/http@main
        with:
          url: >-
            https://proxy.api.makeinfinite.dev/biscuits/generated/${{ secrets.W3_SECRET_DEMO_SXT_BISCUIT_NAME }}
          method: GET
          headers: >-
            {"sid": "${{ steps.login.outputs.sessionId }}"}
          decrypt-inputs: 'headers.sid'
          extract-outputs: 'biscuit'
          encrypt-outputs: 'biscuit'
          encryption-key: ${{ env.ENCRYPTION_KEY }}

      - name: Build query body
        id: build-query
        env:
          ENCRYPTED_BISCUIT: ${{ steps.biscuit.outputs.biscuit }}
          SQL_QUERY: ${{ inputs.sql-query }}
          USER_ID: ${{ inputs.user-id }}
          RESOURCES: ${{ inputs.resources }}
        run: |
          BISCUIT=$(node scripts/decrypt.js "$ENCRYPTION_KEY" "$ENCRYPTED_BISCUIT")
          RESOLVED_SQL=$(echo "$SQL_QUERY" | sed "s/{userId}/$USER_ID/g")
          RESOURCES_JSON=$(echo "$RESOURCES" | jq -R 'split(",") | map(ltrimstr(" ") | rtrimstr(" "))')
          BODY=$(jq -cn \
            --arg sql "$RESOLVED_SQL" \
            --arg biscuit "$BISCUIT" \
            --argjson resources "$RESOURCES_JSON" \
            '{sqlText: $sql, biscuits: [$biscuit], resources: $resources}')
          echo "body=$BODY" >> "$GITHUB_OUTPUT"

      - name: Execute Query
        id: query
        uses: w3-io/demo-gha-containerization-1/http@main
        with:
          url: https://api.makeinfinite.dev/v1/sql
          method: POST
          headers: >-
            {"Content-Type": "application/json",
             "Authorization": "Bearer ${{ steps.login.outputs.accessToken }}"}
          body: ${{ steps.build-query.outputs.body }}
          decrypt-inputs: 'headers.Authorization'
          decode-fields: TOP_LEVEL_HEADERS,BODY_PLAIN_TEXT
          output-fields: TOP_LEVEL_HEADERS,BODY_PLAIN_TEXT
          select-keys: 'TOP_LEVEL_HEADERS:From,Subject'
          limit: ${{ inputs.limit }}
          encrypt-outputs: 'response'
          encryption-key: ${{ env.ENCRYPTION_KEY }}

      - name: Format email list
        id: format
        env:
          ENCRYPTED_RESPONSE: ${{ steps.query.outputs.response }}
        run: |
          QUERY_RESULT=$(node scripts/decrypt.js "$ENCRYPTION_KEY" "$ENCRYPTED_RESPONSE")
          summary=$(echo "$QUERY_RESULT" | jq -r '
            [.[] |
              "From: \(.TOP_LEVEL_HEADERS.From // "unknown")\nSubject: \(.TOP_LEVEL_HEADERS.Subject // "no subject")\nBody: \(.BODY_PLAIN_TEXT // "empty")\n---"
            ] | join("\n")
          ')
          {
            echo "email-summary<<SUMMARY_EOF"
            echo "$summary"
            echo "SUMMARY_EOF"
          } >> "$GITHUB_OUTPUT"
```

## What to Remove

- `src/crypto.js`: Remove `getInput`, `decryptHeaders` functions
- `src/http/main.js`: Remove `response-fields` handling, remove
  `getInput`/`decryptHeaders` usage
- `src/base64-decode/main.js`: Remove `getInput` usage
- `decrypt/` action directory: Delete entirely
- `src/decrypt/` source directory: Delete entirely
- `http/action.yml`: Remove `response-fields` input, `encrypted` output. Rename
  `status` to `status-code`. Add `extract-outputs`, `encrypt-outputs`,
  `decrypt-inputs`.
- `rollup.config.js`: Remove decrypt entry
- `package.json`: Remove decrypt from package script
- `.gitattributes`: Remove decrypt/dist line

## What to Add

- `scripts/decrypt.js`: CLI helper for shell steps
- `src/http/main.js`: `decrypt-inputs` path-based decryption with Bearer
  special case, `extract-outputs` field extraction, `encrypt-outputs` selective
  encryption, `success` and `status-code` outputs
- Tests for new functionality

## What to Keep

- `src/crypto.js`: `encryptValue`, `decryptValue`, `tryDecrypt`,
  `createEncryptedOutput`
- `src/http/main.js`: Post-processing pipeline (`decode-fields`,
  `output-fields`, `select-keys`, `limit`)
- `src/base64-decode/`: Unchanged (except remove `getInput` usage)
