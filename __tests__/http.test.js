/**
 * Unit tests for the HTTP action
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { unlinkSync } from 'fs'

const core = await import('../__fixtures__/core')
jest.unstable_mockModule('@actions/core', () => core)

const { run } = await import('../src/http/main')

describe('http action', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = jest.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.resetAllMocks()
  })

  it('makes a POST request and sets outputs', async () => {
    core.getInput.mockImplementation((name) => {
      const inputs = {
        url: 'https://example.com/api',
        method: 'POST',
        headers: '{"Content-Type": "application/json"}',
        body: '{"key": "value"}'
      }
      return inputs[name] || ''
    })
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '{"result": "ok"}'
    })

    await run()

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"key": "value"}'
      })
    )
    expect(core.setOutput).toHaveBeenCalledWith('status', '200')
    expect(core.setOutput).toHaveBeenCalledWith('response', '{"result": "ok"}')
    expect(core.setOutput).toHaveBeenCalledWith(
      'response-file',
      expect.stringContaining('http-response.json')
    )

    // Clean up
    const filePath = core.setOutput.mock.calls.find(
      (c) => c[0] === 'response-file'
    )[1]
    unlinkSync(filePath)
  })

  it('makes a GET request without body', async () => {
    core.getInput.mockImplementation((name) => {
      const inputs = {
        url: 'https://example.com/data',
        method: 'GET',
        headers: '{"sid": "abc"}'
      }
      return inputs[name] || ''
    })
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '{"data": 1}'
    })

    await run()

    const fetchCall = global.fetch.mock.calls[0]
    expect(fetchCall[1].body).toBeUndefined()
    expect(fetchCall[1].method).toBe('GET')

    const filePath = core.setOutput.mock.calls.find(
      (c) => c[0] === 'response-file'
    )[1]
    unlinkSync(filePath)
  })

  it('sets failure on HTTP error', async () => {
    core.getInput.mockImplementation((name) => {
      const inputs = {
        url: 'https://example.com/fail',
        method: 'POST',
        headers: '{}'
      }
      return inputs[name] || ''
    })
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Server Error'
    })

    await run()

    expect(core.setOutput).toHaveBeenCalledWith('status', '500')
    expect(core.setFailed).toHaveBeenCalledWith('HTTP 500: Server Error')

    const filePath = core.setOutput.mock.calls.find(
      (c) => c[0] === 'response-file'
    )[1]
    unlinkSync(filePath)
  })
})
