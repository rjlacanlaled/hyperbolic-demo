#!/usr/bin/env node
import { createDecipheriv, createHash } from 'crypto'

const [, , key, encrypted, field] = process.argv

if (!key || !encrypted) {
  console.error('Usage: decrypt.js <key> <encrypted> [field]')
  process.exit(1)
}

try {
  const keyHash = createHash('sha256').update(key).digest()
  const buf = Buffer.from(encrypted, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', keyHash, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([
    decipher.update(enc),
    decipher.final()
  ]).toString('utf-8')

  if (field) {
    const parsed = JSON.parse(decrypted)
    const value = parsed[field]
    if (value === undefined) {
      console.error(`Field '${field}' not found`)
      process.exit(1)
    }
    process.stdout.write(
      typeof value === 'string' ? value : JSON.stringify(value)
    )
  } else {
    process.stdout.write(decrypted)
  }
} catch (err) {
  console.error(`Decryption failed: ${err.message}`)
  process.exit(1)
}
