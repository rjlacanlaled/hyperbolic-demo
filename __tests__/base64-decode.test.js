/**
 * Unit tests for the base64-decode action
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { writeFileSync, unlinkSync } from 'fs'
import { resolve } from 'path'

const core = await import('../__fixtures__/core')
jest.unstable_mockModule('@actions/core', () => core)

const { decodeBase64Url, run } = await import('../src/base64-decode/main')

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

  it('decodes specified fields in rows', async () => {
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

    const outPath = core.setOutput.mock.calls.find(
      (c) => c[0] === 'result-file'
    )[1]
    unlinkSync(outPath)
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

    const outPath = core.setOutput.mock.calls.find(
      (c) => c[0] === 'result-file'
    )[1]
    unlinkSync(outPath)
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

    const outPath = core.setOutput.mock.calls.find(
      (c) => c[0] === 'result-file'
    )[1]
    unlinkSync(outPath)
  })
})
