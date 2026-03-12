/**
 * Unit tests for the SxT action, src/sxt/main.js
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from '@jest/globals'
const core = await import('../__fixtures__/core')

jest.unstable_mockModule('@actions/core', () => core)

const { login, getBiscuit, executeQuery, decodeBase64UrlFields, run } =
  await import('../src/sxt/main')

describe('login', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = jest.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.resetAllMocks()
  })

  it('returns session data on success', async () => {
    const mockData = { sessionId: 'sid-123', accessToken: 'tok-abc' }
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockData
    })

    const result = await login('user@test.com', 'pass')

    expect(result).toEqual(mockData)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://proxy.api.makeinfinite.dev/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userId: 'user@test.com', password: 'pass' })
      })
    )
  })

  it('throws on login failure', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    })

    await expect(login('user', 'bad')).rejects.toThrow('Login failed (401)')
  })
})

describe('getBiscuit', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = jest.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.resetAllMocks()
  })

  it('returns biscuit data on success', async () => {
    const mockData = { biscuit: 'biscuit-token-xyz' }
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockData
    })

    const result = await getBiscuit('sid-123', 'my-biscuit')

    expect(result).toEqual(mockData)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://proxy.api.makeinfinite.dev/biscuits/generated/my-biscuit',
      expect.objectContaining({
        method: 'GET',
        headers: { sid: 'sid-123' }
      })
    )
  })

  it('throws on biscuit failure', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found'
    })

    await expect(getBiscuit('sid', 'missing')).rejects.toThrow(
      'Get biscuit failed (404)'
    )
  })
})

describe('executeQuery', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = jest.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.resetAllMocks()
  })

  it('returns rows on success', async () => {
    const mockRows = [{ ID: '1', SUBJECT: 'Hello' }]
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockRows
    })

    const result = await executeQuery('tok-abc', 'SELECT *', ['b1'], 'RES')

    expect(result).toEqual(mockRows)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.makeinfinite.dev/v1/sql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok-abc'
        }),
        body: JSON.stringify({
          sqlText: 'SELECT *',
          biscuits: ['b1'],
          resources: 'RES'
        })
      })
    )
  })

  it('throws on query failure', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request'
    })

    await expect(executeQuery('tok', 'BAD SQL', [], 'R')).rejects.toThrow(
      'Query failed (400)'
    )
  })
})

describe('decodeBase64UrlFields', () => {
  it('decodes BODY_PLAIN_TEXT and BODY_HTML_TEXT fields', () => {
    // "Hello World" in base64url
    const base64url = Buffer.from('Hello World')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

    const rows = [
      { ID: '1', BODY_PLAIN_TEXT: base64url, BODY_HTML_TEXT: base64url }
    ]

    const decoded = decodeBase64UrlFields(rows)

    expect(decoded[0].BODY_PLAIN_TEXT).toBe('Hello World')
    expect(decoded[0].BODY_HTML_TEXT).toBe('Hello World')
    expect(decoded[0].ID).toBe('1')
  })

  it('handles rows without encoded fields', () => {
    const rows = [{ ID: '1', SUBJECT: 'Test' }]
    const decoded = decodeBase64UrlFields(rows)
    expect(decoded).toEqual(rows)
  })

  it('handles empty rows', () => {
    expect(decodeBase64UrlFields([])).toEqual([])
  })
})

describe('run', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = jest.fn()

    core.getInput.mockImplementation((name) => {
      const inputs = {
        'sxt-user-id': 'test-user',
        'sxt-password': 'test-pass',
        'biscuit-name': 'test-biscuit',
        'sql-query': "SELECT * FROM T WHERE USER_ID = '{userId}'",
        limit: '10',
        resources: 'RES_A, RES_B',
        'user-id': 'uid-42'
      }
      return inputs[name] || ''
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.resetAllMocks()
  })

  it('orchestrates login, biscuit, query, and decode', async () => {
    // login
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessionId: 'sid-1', accessToken: 'tok-1' })
    })
    // getBiscuit
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ biscuit: 'b-token' })
    })
    // executeQuery
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ ID: '1', BODY_PLAIN_TEXT: 'SGVsbG8' }]
    })

    await run()

    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect(core.setOutput).toHaveBeenCalledWith(
      'result',
      JSON.stringify([{ ID: '1', BODY_PLAIN_TEXT: 'SGVsbG8' }])
    )
    expect(core.setOutput).toHaveBeenCalledWith(
      'decoded-result',
      expect.any(String)
    )

    // Verify the SQL query had {userId} substituted
    const queryCall = global.fetch.mock.calls[2]
    const body = JSON.parse(queryCall[1].body)
    expect(body.sqlText).toBe("SELECT * FROM T WHERE USER_ID = 'uid-42'")
    expect(body.resources).toEqual(['RES_A', 'RES_B'])
  })

  it('limits rows when limit is set', async () => {
    core.getInput.mockImplementation((name) => {
      const inputs = {
        'sxt-user-id': 'test-user',
        'sxt-password': 'test-pass',
        'biscuit-name': 'test-biscuit',
        'sql-query': "SELECT * FROM T WHERE USER_ID = '{userId}'",
        limit: '2',
        resources: 'RES_A',
        'user-id': 'uid-42'
      }
      return inputs[name] || ''
    })

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessionId: 'sid-1', accessToken: 'tok-1' })
    })
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ biscuit: 'b-token' })
    })
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ ID: '1' }, { ID: '2' }, { ID: '3' }, { ID: '4' }]
    })

    await run()

    const resultCall = core.setOutput.mock.calls.find((c) => c[0] === 'result')
    expect(JSON.parse(resultCall[1])).toHaveLength(2)
  })

  it('sets failure on login error', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Login failed (401)')
    )
  })
})
