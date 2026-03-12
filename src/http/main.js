import * as core from '@actions/core'
import { writeFileSync } from 'fs'
import { resolve } from 'path'

export async function run() {
  try {
    const url = core.getInput('url', { required: true })
    const method = core.getInput('method') || 'POST'
    const headersInput = core.getInput('headers') || '{}'
    const body = core.getInput('body')

    const headers = JSON.parse(headersInput)

    core.info(`${method} ${url}`)

    const options = { method, headers }
    if (body && method !== 'GET' && method !== 'HEAD') {
      options.body = body
    }

    const response = await fetch(url, options)
    const responseBody = await response.text()

    core.setOutput('status', response.status.toString())

    const responsePath = resolve('http-response.json')
    writeFileSync(responsePath, responseBody)

    core.setOutput('response', responseBody)
    core.setOutput('response-file', responsePath)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseBody}`)
    }

    core.info(`Response: ${response.status}`)
  } catch (error) {
    core.error(error.stack || error.toString())
    core.setFailed(error.message)
  }
}
