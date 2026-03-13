import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'child_process'
import { encryptValue } from '../src/crypto.js'

describe('scripts/decrypt.js', () => {
  const key = 'test-key'

  it('decrypts a raw encrypted value', () => {
    const encrypted = encryptValue('hello-world', key)
    const result = execFileSync(
      'node',
      ['scripts/decrypt.js', key, encrypted],
      {
        encoding: 'utf-8'
      }
    ).trim()
    expect(result).toBe('hello-world')
  })

  it('decrypts and extracts a field from encrypted JSON', () => {
    const json = JSON.stringify({ sessionId: 'abc123', extra: 'ignored' })
    const encrypted = encryptValue(json, key)
    const result = execFileSync(
      'node',
      ['scripts/decrypt.js', key, encrypted, 'sessionId'],
      { encoding: 'utf-8' }
    ).trim()
    expect(result).toBe('abc123')
  })

  it('exits with error on invalid encrypted value', () => {
    expect(() => {
      execFileSync('node', ['scripts/decrypt.js', key, 'not-encrypted'], {
        encoding: 'utf-8'
      })
    }).toThrow()
  })
})
