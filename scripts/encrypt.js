#!/usr/bin/env node
import { createCipheriv, createHash, randomBytes } from 'crypto'

const [, , key, value] = process.argv

if (!key || !value) {
  console.error('Usage: encrypt.js <key> <value>')
  process.exit(1)
}

try {
  const keyHash = createHash('sha256').update(key).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyHash, iv)
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf-8'),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()
  const result = Buffer.concat([iv, tag, encrypted]).toString('base64')
  process.stdout.write(result)
} catch (err) {
  console.error(`Encryption failed: ${err.message}`)
  process.exit(1)
}
