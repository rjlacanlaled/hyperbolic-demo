/**
 * Unit tests for the HTTP action
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

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
        body: '{"key":"value"}'
      })
    )
    expect(core.setOutput).toHaveBeenCalledWith('success', 'true')
    expect(core.setOutput).toHaveBeenCalledWith('status-code', '200')
    expect(core.setOutput).toHaveBeenCalledWith('response', '{"result": "ok"}')
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

    expect(core.setOutput).toHaveBeenCalledWith('success', 'false')
    expect(core.setOutput).toHaveBeenCalledWith('status-code', '500')
    expect(core.setFailed).toHaveBeenCalledWith('HTTP 500: Server Error')
  })

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

  it('decrypts entire body via decrypt-inputs: body', async () => {
    const { encryptValue } = await import('../src/crypto.js')
    const originalBody = '{"sqlText": "SELECT *", "biscuits": ["token123"]}'
    const encryptedBody = encryptValue(originalBody, 'test-key')
    core.getInput.mockImplementation((name) => {
      const inputs = {
        url: 'https://example.com/api',
        method: 'POST',
        headers: '{"Content-Type": "application/json"}',
        body: encryptedBody,
        'decrypt-inputs': 'body',
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
    expect(sentBody.sqlText).toBe('SELECT *')
    expect(sentBody.biscuits).toEqual(['token123'])
  })

  it('encrypts response when encryption-key is provided and encrypt-outputs includes response', async () => {
    core.getInput.mockImplementation((name) => {
      const inputs = {
        url: 'https://example.com/api',
        method: 'POST',
        headers: '{}',
        'encryption-key': 'test-secret-key',
        'encrypt-outputs': 'response'
      }
      return inputs[name] || ''
    })
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '{"secret": "data"}'
    })

    await run()

    const responseCall = core.setOutput.mock.calls.find(
      (c) => c[0] === 'response'
    )
    // Response should be encrypted (base64 string, not original JSON)
    expect(responseCall[1]).not.toBe('{"secret": "data"}')
    expect(typeof responseCall[1]).toBe('string')
  })
})
