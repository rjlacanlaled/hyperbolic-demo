import * as core from '@actions/core'
import { createEncryptedOutput, tryDecrypt } from '../crypto.js'
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
    const setEncryptedOutput = createEncryptedOutput(core, encryptionKey)

    const url = core.getInput('url', { required: true })
    const method = core.getInput('method') || 'POST'
    const headersRaw = core.getInput('headers') || '{}'
    const bodyRaw = core.getInput('body')

    // Parse mutable copies
    const inputStore = {
      headers: JSON.parse(headersRaw)
    }

    // Try parsing body as JSON for path-based decryption
    let bodyIsJson = false
    if (bodyRaw) {
      try {
        inputStore.body = JSON.parse(bodyRaw)
        bodyIsJson = true
      } catch {
        inputStore.body = bodyRaw
      }
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

    core.info(`${method} ${url}`)

    const options = { method, headers }
    if (body && method !== 'GET' && method !== 'HEAD') {
      options.body = body
    }

    const response = await fetch(url, options)
    const responseBody = await response.text()

    const responseBytes = Buffer.byteLength(responseBody, 'utf-8')
    core.info(
      `Response: ${response.status} | Size: ${responseBytes} bytes (${(responseBytes / 1024).toFixed(1)} KB)`
    )

    core.setOutput('status', response.status.toString())

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseBody}`)
    }

    // Extract individual JSON fields as separate outputs (response-fields — will be replaced by extract-outputs in Task 3)
    const responseFields = core.getInput('response-fields')
    if (responseFields) {
      const parsed = JSON.parse(responseBody)
      for (const field of responseFields.split(',').map((f) => f.trim())) {
        if (parsed[field] !== undefined) {
          const value =
            typeof parsed[field] === 'string'
              ? parsed[field]
              : JSON.stringify(parsed[field])
          setEncryptedOutput(field, value)
        }
      }
    }

    // Optional post-processing for JSON array responses
    const decodeFields = core.getInput('decode-fields')
    const outputFields = core.getInput('output-fields')
    const selectKeys = core.getInput('select-keys')
    const limit = parseInt(core.getInput('limit') || '0', 10)

    let processedOutput = responseBody

    if (decodeFields || outputFields || selectKeys || limit > 0) {
      let rows = JSON.parse(responseBody)

      if (limit > 0 && rows.length > limit) {
        core.info(`Limiting from ${rows.length} to ${limit} rows`)
        rows = rows.slice(0, limit)
      }

      const fieldsToDecode = decodeFields
        ? decodeFields.split(',').map((f) => f.trim())
        : []
      const keySelections = parseSelectKeys(selectKeys)
      const fieldsToOutput = outputFields
        ? outputFields.split(',').map((f) => f.trim())
        : null

      rows = rows.map((row) => {
        let result = { ...row }

        for (const field of fieldsToDecode) {
          if (result[field]) {
            result[field] = decodeBase64Url(result[field])
          }
        }

        for (const [field, keys] of Object.entries(keySelections)) {
          if (result[field]) {
            result[field] = extractKeys(result[field], keys)
          }
        }

        if (fieldsToOutput) {
          const filtered = {}
          for (const f of fieldsToOutput) {
            if (f in result) filtered[f] = result[f]
          }
          result = filtered
        }

        return result
      })

      processedOutput = JSON.stringify(rows)
      const outputBytes = Buffer.byteLength(processedOutput, 'utf-8')
      core.info(
        `Processed: ${outputBytes} bytes (${(outputBytes / 1024).toFixed(1)} KB) | Rows: ${rows.length}`
      )
    }

    setEncryptedOutput('response', processedOutput)
    core.setOutput('encrypted', encryptionKey ? 'true' : 'false')
  } catch (error) {
    core.error(error.stack || error.toString())
    core.setFailed(error.message)
  }
}
