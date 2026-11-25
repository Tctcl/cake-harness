import { createPrivateKey, createPublicKey } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { generateSshKeyPair } from './openssh-private-key.js'
import { validatePublicKey } from './public-key.js'

const fields = (source: Buffer): readonly Buffer[] => {
  const result: Buffer[] = []
  let offset = 0
  for (let index = 0; index < 4; index += 1) {
    const length = source.readUInt32BE(offset)
    offset += 4
    if (length > source.length - offset) throw new Error('invalid OpenSSH private field')
    result.push(source.subarray(offset, offset + length))
    offset += length
  }

  return result
}

/** Decode the private section and wrap its seed in Node's PKCS#8 DER, which createPrivateKey accepts. */
const parseGeneratedPrivateKey = (pem: string) => {
  const base64 = pem.split('\n').filter((line) => !line.startsWith('-----') && line !== '').join('')
  const payload = Buffer.from(base64, 'base64')
  expect(payload.subarray(0, 15).toString('ascii')).toBe('openssh-key-v1\0')
  const cipherLength = payload.readUInt32BE(15)
  const kdfLengthOffset = 19 + cipherLength
  const kdfLength = payload.readUInt32BE(kdfLengthOffset)
  const optionsLengthOffset = kdfLengthOffset + 4 + kdfLength
  const optionsLength = payload.readUInt32BE(optionsLengthOffset)
  const countOffset = optionsLengthOffset + 4 + optionsLength
  expect(payload.readUInt32BE(countOffset)).toBe(1)
  const publicLengthOffset = countOffset + 4
  const publicLength = payload.readUInt32BE(publicLengthOffset)
  const privateLengthOffset = publicLengthOffset + 4 + publicLength
  const privateLength = payload.readUInt32BE(privateLengthOffset)
  const privateSection = payload.subarray(privateLengthOffset + 4, privateLengthOffset + 4 + privateLength)
  const inner = fields(privateSection.subarray(8))
  expect(inner[0]?.toString()).toBe('ssh-ed25519')
  const secret = inner[2]
  if (secret === undefined || secret.length !== 64) throw new Error('invalid Ed25519 secret')
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), secret.subarray(0, 32)])

  return { key: createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }), secret }
}

describe('generateSshKeyPair', () => {
  it('returns an OpenSSH private key whose seed parses back to the same Ed25519 key', () => {
    const generated = generateSshKeyPair()
    expect(generated.privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n/)

    const { key, secret } = parseGeneratedPrivateKey(generated.privateKey)
    expect(key.asymmetricKeyType).toBe('ed25519')
    const publicDer = createPublicKey(key).export({ format: 'der', type: 'spki' })
    expect(publicDer.subarray(-32).equals(secret.subarray(32))).toBe(true)
    expect(validatePublicKey(generated.publicKey).fingerprint).toMatch(/^SHA256:/)
  })
})
