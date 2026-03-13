/**
 * Unit tests for the crypto module
 */
import { describe, expect, it, jest } from '@jest/globals'
import {
  encryptValue,
  decryptValue,
  createEncryptedOutput,
  getInput
} from '../src/crypto.js'

describe('encryptValue / decryptValue', () => {
  it('round-trips a string', () => {
    const key = 'my-secret-key'
    const plaintext = 'Hello World'
    const encrypted = encryptValue(plaintext, key)
    expect(encrypted).not.toBe(plaintext)
    expect(decryptValue(encrypted, key)).toBe(plaintext)
  })

  it('produces different ciphertexts for same input (random IV)', () => {
    const key = 'my-secret-key'
    const a = encryptValue('test', key)
    const b = encryptValue('test', key)
    expect(a).not.toBe(b)
  })

  it('fails with wrong key', () => {
    const encrypted = encryptValue('secret', 'key1')
    expect(() => decryptValue(encrypted, 'key2')).toThrow()
  })
})

describe('createEncryptedOutput', () => {
  it('encrypts when key is provided', () => {
    const outputs = {}
    const core = {
      setOutput: jest.fn((name, value) => {
        outputs[name] = value
      })
    }
    const setOutput = createEncryptedOutput(core, 'my-key')
    setOutput('response', 'plain text')

    expect(core.setOutput).toHaveBeenCalledTimes(1)
    expect(outputs.response).not.toBe('plain text')
    expect(decryptValue(outputs.response, 'my-key')).toBe('plain text')
  })

  it('passes through when no key', () => {
    const core = { setOutput: jest.fn() }
    const setOutput = createEncryptedOutput(core, '')
    setOutput('response', 'plain text')

    expect(core.setOutput).toHaveBeenCalledWith('response', 'plain text')
  })
})

describe('getInput', () => {
  it('decrypts encrypted input when key is set', () => {
    const encrypted = encryptValue('secret-body', 'my-key')
    const core = {
      getInput: jest.fn(() => encrypted)
    }
    const result = getInput(core, 'my-key', 'body')
    expect(result).toBe('secret-body')
  })

  it('returns raw value when input is not encrypted', () => {
    const core = {
      getInput: jest.fn(() => 'plain-value')
    }
    const result = getInput(core, 'my-key', 'body')
    expect(result).toBe('plain-value')
  })

  it('returns raw value when no key', () => {
    const core = {
      getInput: jest.fn(() => 'plain-value')
    }
    const result = getInput(core, '', 'body')
    expect(result).toBe('plain-value')
  })

  it('passes options through to core.getInput', () => {
    const core = {
      getInput: jest.fn(() => '')
    }
    getInput(core, '', 'url', { required: true })
    expect(core.getInput).toHaveBeenCalledWith('url', { required: true })
  })
})
