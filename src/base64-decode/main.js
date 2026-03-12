import * as core from '@actions/core'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Decode a base64url-encoded string to UTF-8.
 */
export function decodeBase64Url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

export async function run() {
  try {
    const inputFile = core.getInput('input-file', { required: true })
    const fields = core
      .getInput('fields', { required: true })
      .split(',')
      .map((f) => f.trim())
    const limit = parseInt(core.getInput('limit') || '0', 10)

    core.info(`Reading ${inputFile}`)
    const rows = JSON.parse(readFileSync(inputFile, 'utf-8'))

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

    const resultPath = resolve('base64-decoded.json')
    writeFileSync(resultPath, JSON.stringify(decoded))

    core.setOutput('result-file', resultPath)
    core.setOutput('result', JSON.stringify(decoded))
    core.info(`Decoded ${decoded.length} rows`)
  } catch (error) {
    core.error(error.stack || error.toString())
    core.setFailed(error.message)
  }
}
