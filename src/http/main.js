import * as core from '@actions/core'
import { createEncryptedOutput, decryptInput } from '../crypto.js'

export async function run() {
  try {
    const encryptionKey = core.getInput('encryption-key')
    const encryptedInputs = core.getInput('encrypted-inputs')

    const setEncryptedOutput = createEncryptedOutput(core, encryptionKey)

    const url = core.getInput('url', { required: true })
    const method = core.getInput('method') || 'POST'
    const headersInput =
      decryptInput(core, encryptionKey, encryptedInputs, 'headers') || '{}'
    const body = decryptInput(core, encryptionKey, encryptedInputs, 'body')

    const headers = JSON.parse(headersInput)

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
    setEncryptedOutput('response', responseBody)
    core.setOutput('encrypted', encryptionKey ? 'true' : 'false')

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseBody}`)
    }
  } catch (error) {
    core.error(error.stack || error.toString())
    core.setFailed(error.message)
  }
}
