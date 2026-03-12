import * as core from '@actions/core'
import { writeFileSync } from 'fs'
import { resolve } from 'path'

const AUTH_BASE_URL = 'https://proxy.api.makeinfinite.dev'
const SXT_API_URL = 'https://api.makeinfinite.dev'

/**
 * Authenticate with SxT and return a session ID.
 */
export async function login(userId, password) {
  const response = await fetch(`${AUTH_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password })
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Login failed (${response.status}): ${body}`)
  }

  const json = await response.json()
  return json
}

/**
 * Retrieve a generated biscuit by name.
 */
export async function getBiscuit(sessionId, biscuitName) {
  const response = await fetch(
    `${AUTH_BASE_URL}/biscuits/generated/${biscuitName}`,
    {
      method: 'GET',
      headers: { sid: sessionId }
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Get biscuit failed (${response.status}): ${body}`)
  }

  const json = await response.json()
  return json
}

/**
 * Execute a SQL query against SxT.
 */
export async function executeQuery(accessToken, sqlText, biscuits, resources) {
  const response = await fetch(`${SXT_API_URL}/v1/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      sqlText,
      biscuits,
      resources
    })
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Query failed (${response.status}): ${body}`)
  }

  const json = await response.json()
  return json
}

/**
 * Decode base64url-encoded fields (BODY_PLAIN_TEXT, BODY_HTML_TEXT) in query rows.
 * Gmail uses base64url encoding: `-` → `+`, `_` → `/`.
 */
export function decodeBase64UrlFields(rows) {
  const fieldsToEncode = ['BODY_PLAIN_TEXT', 'BODY_HTML_TEXT']

  return rows.map((row) => {
    const decoded = { ...row }
    for (const field of fieldsToEncode) {
      if (decoded[field]) {
        const base64 = decoded[field].replace(/-/g, '+').replace(/_/g, '/')
        decoded[field] = Buffer.from(base64, 'base64').toString('utf-8')
      }
    }
    return decoded
  })
}

/**
 * The main function for the SxT action.
 */
export async function run() {
  try {
    const userId = core.getInput('sxt-user-id', { required: true })
    const password = core.getInput('sxt-password', { required: true })
    const biscuitName = core.getInput('biscuit-name', { required: true })
    const sqlQuery = core.getInput('sql-query', { required: true })
    const resources = core.getInput('resources', { required: true })
    const queryUserId = core.getInput('user-id', { required: true })
    const limit = parseInt(core.getInput('limit') || '0', 10)

    // Substitute {userId} placeholder in the SQL query
    const resolvedQuery = sqlQuery.replace(/\{userId\}/g, queryUserId)

    core.info('Logging in to SxT...')
    const loginResult = await login(userId, password)
    const sessionId = loginResult.sessionId
    const accessToken = loginResult.accessToken

    core.info(`Fetching biscuit: ${biscuitName}`)
    const biscuitResult = await getBiscuit(sessionId, biscuitName)
    const biscuits = [biscuitResult.biscuit]

    core.info('Executing SQL query...')
    const rows = await executeQuery(
      accessToken,
      resolvedQuery,
      biscuits,
      resources.split(',').map((r) => r.trim())
    )

    core.info(`Query returned ${rows.length} rows`)

    const limitedRows = limit > 0 ? rows.slice(0, limit) : rows
    if (limit > 0 && rows.length > limit) {
      core.info(`Limiting output to ${limit} rows`)
    }

    const decodedRows = decodeBase64UrlFields(limitedRows)

    // Write results to files to avoid env var size limits
    const resultPath = resolve('sxt-result.json')
    const decodedPath = resolve('sxt-decoded-result.json')

    writeFileSync(resultPath, JSON.stringify(limitedRows))
    writeFileSync(decodedPath, JSON.stringify(decodedRows))

    core.setOutput('result-file', resultPath)
    core.setOutput('decoded-result-file', decodedPath)
    core.setOutput('result', JSON.stringify(limitedRows))
    core.setOutput('decoded-result', JSON.stringify(decodedRows))
  } catch (error) {
    core.error(error.stack || error.toString())
    core.setFailed(error.message)
  }
}
