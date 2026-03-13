import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

/**
 * Derive a 32-byte key from a passphrase using SHA-256.
 */
function deriveKey(passphrase) {
  return createHash('sha256').update(passphrase).digest()
}

/**
 * Encrypt a string using AES-256-GCM.
 * Returns base64(iv + authTag + ciphertext).
 */
export function encryptValue(plaintext, key) {
  const keyHash = deriveKey(key)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyHash, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/**
 * Decrypt an AES-256-GCM ciphertext.
 * Expects base64(iv + authTag + ciphertext).
 */
export function decryptValue(ciphertext, key) {
  const keyHash = deriveKey(key)
  const buf = Buffer.from(ciphertext, 'base64')

  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const encrypted = buf.subarray(28)

  const decipher = createDecipheriv('aes-256-gcm', keyHash, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf-8'
  )
}

/**
 * Returns a function that wraps core.setOutput with encryption.
 * If encryptionKey is provided, values are encrypted automatically.
 */
export function createEncryptedOutput(core, encryptionKey) {
  return (name, value) => {
    if (encryptionKey) {
      core.setOutput(name, encryptValue(value, encryptionKey))
    } else {
      core.setOutput(name, value)
    }
  }
}

/**
 * Get an input value, automatically decrypting if encryption key is set.
 * If decryption fails (input wasn't encrypted), returns the raw value.
 */
export function getInput(core, encryptionKey, name, options) {
  const value = core.getInput(name, options)
  if (encryptionKey && value) {
    try {
      return decryptValue(value, encryptionKey)
    } catch {
      return value
    }
  }
  return value
}
