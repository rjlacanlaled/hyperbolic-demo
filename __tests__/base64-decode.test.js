/**
 * Unit tests for the base64-decode action
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { writeFileSync, unlinkSync } from 'fs'
import { resolve } from 'path'

const core = await import('../__fixtures__/core')
jest.unstable_mockModule('@actions/core', () => core)

const { decodeBase64Url, parseSelectKeys, extractKeys, run } = await import(
  '../src/base64-decode/main'
)

describe('decodeBase64Url', () => {
  it('decodes a base64url string', () => {
    const encoded = Buffer.from('Hello World')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
    expect(decodeBase64Url(encoded)).toBe('Hello World')
  })

  it('decodes standard base64', () => {
    const encoded = Buffer.from('Test 123').toString('base64')
    expect(decodeBase64Url(encoded)).toBe('Test 123')
  })
})

describe('parseSelectKeys', () => {
  it('parses field:key1,key2 format', () => {
    expect(parseSelectKeys('HEADERS:From,Subject')).toEqual({
      HEADERS: ['From', 'Subject']
    })
  })

  it('parses multiple fields separated by semicolons', () => {
    expect(parseSelectKeys('HEADERS:From,Subject;META:Date')).toEqual({
      HEADERS: ['From', 'Subject'],
      META: ['Date']
    })
  })

  it('returns empty object for empty input', () => {
    expect(parseSelectKeys('')).toEqual({})
    expect(parseSelectKeys(null)).toEqual({})
  })
})

describe('extractKeys', () => {
  it('extracts named keys from {name, value} array', () => {
    const json = JSON.stringify([
      { name: 'From', value: 'alice@test.com' },
      { name: 'Subject', value: 'Hello' },
      { name: 'DKIM-Signature', value: 'v=1; a=rsa-sha256; ...' }
    ])
    expect(extractKeys(json, ['From', 'Subject'])).toEqual({
      From: 'alice@test.com',
      Subject: 'Hello'
    })
  })

  it('returns empty object when no keys match', () => {
    const json = JSON.stringify([{ name: 'X-Custom', value: 'val' }])
    expect(extractKeys(json, ['From'])).toEqual({})
  })
})

describe('base64-decode action', () => {
  let inputPath

  beforeEach(() => {
    jest.resetAllMocks()
    inputPath = resolve('test-b64-input.json')
  })

  afterEach(() => {
    try {
      unlinkSync(inputPath)
    } catch {
      // ignore
    }
  })

  it('decodes specified fields from input-file', async () => {
    const rows = [
      {
        ID: '1',
        BODY: Buffer.from('Hello body').toString('base64'),
        HEADER: Buffer.from('From: alice').toString('base64')
      }
    ]
    writeFileSync(inputPath, JSON.stringify(rows))

    core.getInput.mockImplementation((name) => {
      const inputs = {
        'input-file': inputPath,
        fields: 'BODY,HEADER',
        limit: '0'
      }
      return inputs[name] || ''
    })

    await run()

    const resultCall = core.setOutput.mock.calls.find(
      (c) => c[0] === 'result'
    )
    const decoded = JSON.parse(resultCall[1])
    expect(decoded[0].BODY).toBe('Hello body')
    expect(decoded[0].HEADER).toBe('From: alice')
    expect(decoded[0].ID).toBe('1')
    expect(core.setOutput).toHaveBeenCalledWith('encrypted', 'false')
  })

  it('decodes specified fields from input string', async () => {
    const rows = [
      {
        ID: '2',
        BODY: Buffer.from('Inline body').toString('base64')
      }
    ]

    core.getInput.mockImplementation((name) => {
      const inputs = {
        input: JSON.stringify(rows),
        fields: 'BODY',
        limit: '0'
      }
      return inputs[name] || ''
    })

    await run()

    const resultCall = core.setOutput.mock.calls.find(
      (c) => c[0] === 'result'
    )
    const decoded = JSON.parse(resultCall[1])
    expect(decoded[0].BODY).toBe('Inline body')
    expect(decoded[0].ID).toBe('2')
  })

  it('filters output to specified fields only', async () => {
    const rows = [
      {
        ID: '1',
        BODY: Buffer.from('text').toString('base64'),
        EXTRA: 'drop me'
      }
    ]

    core.getInput.mockImplementation((name) => {
      const inputs = {
        input: JSON.stringify(rows),
        fields: 'BODY',
        limit: '0',
        'output-fields': 'BODY'
      }
      return inputs[name] || ''
    })

    await run()

    const resultCall = core.setOutput.mock.calls.find(
      (c) => c[0] === 'result'
    )
    const decoded = JSON.parse(resultCall[1])
    expect(decoded[0]).toEqual({ BODY: 'text' })
    expect(decoded[0].ID).toBeUndefined()
    expect(decoded[0].EXTRA).toBeUndefined()
  })

  it('extracts keys from decoded JSON arrays via select-keys', async () => {
    const headers = JSON.stringify([
      { name: 'From', value: 'alice@test.com' },
      { name: 'Subject', value: 'Hi' },
      { name: 'DKIM-Signature', value: 'v=1; a=rsa-sha256; huge...' }
    ])
    const rows = [
      {
        ID: '1',
        HEADERS: Buffer.from(headers).toString('base64'),
        BODY: Buffer.from('Hello').toString('base64')
      }
    ]

    core.getInput.mockImplementation((name) => {
      const inputs = {
        input: JSON.stringify(rows),
        fields: 'HEADERS,BODY',
        limit: '0',
        'output-fields': 'HEADERS,BODY',
        'select-keys': 'HEADERS:From,Subject'
      }
      return inputs[name] || ''
    })

    await run()

    const resultCall = core.setOutput.mock.calls.find(
      (c) => c[0] === 'result'
    )
    const decoded = JSON.parse(resultCall[1])
    expect(decoded[0].HEADERS).toEqual({
      From: 'alice@test.com',
      Subject: 'Hi'
    })
    expect(decoded[0].BODY).toBe('Hello')
  })

  it('respects limit parameter', async () => {
    const rows = [
      { BODY: Buffer.from('a').toString('base64') },
      { BODY: Buffer.from('b').toString('base64') },
      { BODY: Buffer.from('c').toString('base64') }
    ]
    writeFileSync(inputPath, JSON.stringify(rows))

    core.getInput.mockImplementation((name) => {
      const inputs = {
        'input-file': inputPath,
        fields: 'BODY',
        limit: '2'
      }
      return inputs[name] || ''
    })

    await run()

    const resultCall = core.setOutput.mock.calls.find(
      (c) => c[0] === 'result'
    )
    const decoded = JSON.parse(resultCall[1])
    expect(decoded).toHaveLength(2)
    expect(decoded[0].BODY).toBe('a')
    expect(decoded[1].BODY).toBe('b')
  })

  it('skips missing fields gracefully', async () => {
    const rows = [{ ID: '1' }]
    writeFileSync(inputPath, JSON.stringify(rows))

    core.getInput.mockImplementation((name) => {
      const inputs = {
        'input-file': inputPath,
        fields: 'BODY',
        limit: '0'
      }
      return inputs[name] || ''
    })

    await run()

    const resultCall = core.setOutput.mock.calls.find(
      (c) => c[0] === 'result'
    )
    const decoded = JSON.parse(resultCall[1])
    expect(decoded[0]).toEqual({ ID: '1' })
  })

  it('fails when neither input nor input-file provided', async () => {
    core.getInput.mockImplementation((name) => {
      const inputs = {
        fields: 'BODY',
        limit: '0'
      }
      return inputs[name] || ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Either input or input-file must be provided'
    )
  })

  it('encrypts result when encryption-key is provided', async () => {
    const rows = [{ BODY: Buffer.from('secret').toString('base64') }]

    core.getInput.mockImplementation((name) => {
      const inputs = {
        input: JSON.stringify(rows),
        fields: 'BODY',
        limit: '0',
        'encryption-key': 'test-secret-key'
      }
      return inputs[name] || ''
    })

    await run()

    expect(core.setOutput).toHaveBeenCalledWith('encrypted', 'true')
    const resultCall = core.setOutput.mock.calls.find(
      (c) => c[0] === 'result'
    )
    // Result should be encrypted, not plain JSON
    expect(() => JSON.parse(resultCall[1])).toThrow()
  })
})
