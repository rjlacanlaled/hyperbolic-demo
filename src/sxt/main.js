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
 * Decode a base64url-encoded string to UTF-8.
 */
export function decodeBase64Url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

/**
 * Extract a header value by name from decoded TOP_LEVEL_HEADERS JSON array.
 */
function getHeader(headers, name) {
  const entry = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  )
  return entry ? entry.value : null
}

/**
 * Decode rows: parse TOP_LEVEL_HEADERS for From/Subject, decode body fields,
 * and return only the fields needed for summarization.
 */
export function decodeRows(rows) {
  return rows.map((row) => {
    let from = null
    let subject = null

    if (row.TOP_LEVEL_HEADERS) {
      try {
        const headers = JSON.parse(decodeBase64Url(row.TOP_LEVEL_HEADERS))
        from = getHeader(headers, 'From')
        subject = getHeader(headers, 'Subject')
      } catch {
        // If headers can't be parsed, leave as null
      }
    }

    const body = row.BODY_PLAIN_TEXT
      ? decodeBase64Url(row.BODY_PLAIN_TEXT)
      : null

    return { FROM: from, SUBJECT: subject, BODY: body }
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

    const decodedRows = decodeRows(limitedRows)

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
