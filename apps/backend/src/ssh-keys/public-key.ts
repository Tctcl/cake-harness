import { createHash } from 'node:crypto'

import { AppError } from '../errors.js'

export interface ValidatedPublicKey {
  /** Canonical two-field authorized_keys line, without an untrusted comment. */
  readonly publicKey: string
  readonly fingerprint: string
}

const invalid = (reason = 'the public key is not valid OpenSSH material'): AppError =>
  new AppError(reason, { statusCode: 400, code: 'SSH_KEY_INVALID' })

const wireFields = (blob: Buffer): readonly Buffer[] => {
  const fields: Buffer[] = []
  let offset = 0
  while (offset < blob.length) {
    if (blob.length - offset < 4) throw invalid()
    const length = blob.readUInt32BE(offset)
    offset += 4
    if (length > blob.length - offset) throw invalid()
    fields.push(blob.subarray(offset, offset + length))
    offset += length
  }

  return fields
}

const positiveInteger = (field: Buffer): Buffer => {
  if (field.length === 0 || (field[0] !== undefined && (field[0] & 0x80) !== 0)) throw invalid()
  const first = field.findIndex((byte) => byte !== 0)

  return first < 0 ? Buffer.alloc(0) : field.subarray(first)
}

const bitLength = (integer: Buffer): number => {
  const first = integer[0]
  if (first === undefined) return 0

  return (integer.length - 1) * 8 + (32 - Math.clz32(first))
}

const validateBlob = (type: string, blob: Buffer): void => {
  const fields = wireFields(blob)
  if (fields[0]?.toString('ascii') !== type) throw invalid()

  if (type === 'ssh-ed25519') {
    if (fields.length !== 2 || fields[1]?.length !== 32) throw invalid()
    return
  }

  if (type === 'ssh-rsa') {
    if (fields.length !== 3) throw invalid()
    const exponent = positiveInteger(fields[1] ?? Buffer.alloc(0))
    const modulus = positiveInteger(fields[2] ?? Buffer.alloc(0))
    if (bitLength(exponent) < 2 || bitLength(modulus) < 3072) {
      throw invalid('ssh-rsa keys must have a modulus of at least 3072 bits')
    }
    return
  }

  const curve = type.replace('ecdsa-sha2-', '')
  const coordinateBytes = { nistp256: 32, nistp384: 48, nistp521: 66 }[curve]
  if (coordinateBytes === undefined || fields.length !== 3) throw invalid()
  if (fields[1]?.toString('ascii') !== curve || fields[2]?.[0] !== 4 || fields[2].length !== coordinateBytes * 2 + 1) {
    throw invalid()
  }
}

/** Validates both the textual OpenSSH line and the algorithm-specific SSH wire blob it carries. */
export const validatePublicKey = (source: string): ValidatedPublicKey => {
  const line = source.trim()
  if (line.length === 0 || line.length > 16_384 || /[\r\n\0]/.test(line)) throw invalid()
  const [type, encoded, ...comment] = line.split(/\s+/)
  if (type === undefined || encoded === undefined || comment.length > 0 && comment.join(' ').length > 1024) {
    throw invalid()
  }
  if (type !== 'ssh-ed25519' && type !== 'ssh-rsa' && !type.startsWith('ecdsa-sha2-')) throw invalid()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw invalid()

  const blob = Buffer.from(encoded, 'base64')
  if (blob.toString('base64') !== encoded || blob.length > 8192) throw invalid()
  validateBlob(type, blob)

  return {
    publicKey: `${type} ${encoded}`,
    fingerprint: `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`,
  }
}
