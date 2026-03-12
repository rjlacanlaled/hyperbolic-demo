import * as core from '@actions/core'
import { readFileSync } from 'fs'
import { createEncryptedOutput, decryptInput } from '../crypto.js'

/**
 * Decode a base64url-encoded string to UTF-8.
 */
export function decodeBase64Url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

export async function run() {
  try {
    const encryptionKey = core.getInput('encryption-key')
    const encryptedInputs = core.getInput('encrypted-inputs')

    const setEncryptedOutput = createEncryptedOutput(core, encryptionKey)

    const inputFile = core.getInput('input-file')
    const input = decryptInput(core, encryptionKey, encryptedInputs, 'input')
    const fields = core
      .getInput('fields', { required: true })
      .split(',')
      .map((f) => f.trim())
    const limit = parseInt(core.getInput('limit') || '0', 10)

    let rawData
    if (input) {
      rawData = input
    } else if (inputFile) {
      core.info(`Reading ${inputFile}`)
      rawData = readFileSync(inputFile, 'utf-8')
    } else {
      throw new Error('Either input or input-file must be provided')
    }

    const rows = JSON.parse(rawData)

    const limitedRows = limit > 0 ? rows.slice(0, limit) : rows
    if (limit > 0 && rows.length > limit) {
      core.info(`Limiting from ${rows.length} to ${limit} rows`)
    }

    const decoded = limitedRows.map((row) => {
      const result = { ...row }
      for (const field of fields) {
        if (result[field]) {
          result[field] = decodeBase64Url(result[field])
        }
      }
      return result
    })

    setEncryptedOutput('result', JSON.stringify(decoded))
    core.setOutput('encrypted', encryptionKey ? 'true' : 'false')
    core.info(`Decoded ${decoded.length} rows`)
  } catch (error) {
    core.error(error.stack || error.toString())
    core.setFailed(error.message)
  }
}
