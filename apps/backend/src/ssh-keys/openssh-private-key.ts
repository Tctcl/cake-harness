import { generateKeyPairSync, randomBytes } from 'node:crypto'

export interface GeneratedSshKeyPair {
  readonly publicKey: string
  readonly privateKey: string
}

const uint32 = (value: number): Buffer => {
  const encoded = Buffer.allocUnsafe(4)
  encoded.writeUInt32BE(value)

  return encoded
}

const wireString = (value: string | Buffer): Buffer => {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value

  return Buffer.concat([uint32(bytes.length), bytes])
}

const publicBlob = (publicKey: Buffer): Buffer =>
  Buffer.concat([wireString('ssh-ed25519'), wireString(publicKey)])

/** OpenSSH's unencrypted private-key container, implemented here because Node exports PKCS#8 but not this PEM armor. */
const openSshPrivateKey = (seed: Buffer, publicKey: Buffer): string => {
  const check = randomBytes(4)
  const secret = Buffer.concat([
    check,
    check,
    wireString('ssh-ed25519'),
    wireString(publicKey),
    // Ed25519's OpenSSH secret field is the 32-byte seed followed by its 32-byte public key.
    wireString(Buffer.concat([seed, publicKey])),
    wireString('cake'),
  ])
  const padding = Buffer.alloc((8 - (secret.length % 8)) % 8)
  for (const [index] of padding.entries()) padding[index] = index + 1

  const payload = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'ascii'),
    wireString('none'),
    wireString('none'),
    wireString(''),
    uint32(1),
    wireString(publicBlob(publicKey)),
    wireString(Buffer.concat([secret, padding])),
  ])
  const base64 = payload.toString('base64').match(/.{1,70}/g)?.join('\n') ?? ''

  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${base64}\n-----END OPENSSH PRIVATE KEY-----\n`
}

/** The private half exists only in this return value; the repository and API never accept it for storage. */
export const generateSshKeyPair = (): GeneratedSshKeyPair => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' })
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  // Node's fixed Ed25519 DER wrappers are 16 and 12 bytes respectively. Checking the shape avoids silently slicing a
  // different key if a runtime changes its encoding.
  if (pkcs8.length !== 48 || spki.length !== 44) throw new Error('unexpected Ed25519 DER encoding')
  const seed = pkcs8.subarray(-32)
  const rawPublicKey = spki.subarray(-32)

  return {
    publicKey: `ssh-ed25519 ${publicBlob(rawPublicKey).toString('base64')}`,
    privateKey: openSshPrivateKey(seed, rawPublicKey),
  }
}
