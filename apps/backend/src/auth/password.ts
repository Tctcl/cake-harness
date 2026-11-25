import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

import { AppError } from '../errors.js'

/**
 * Passwords are hashed with scrypt from the standard library: a password hash is a maintenance contract, and Node ships
 * one that is memory-hard and does not rot. The parameters are stored with the hash, so raising the cost later verifies
 * old hashes with the cost they were made with instead of locking everyone out.
 *
 * Cost 16384/8/1 is the interactive profile from the scrypt paper — ~16 MiB and a few tens of milliseconds.
 */
const COST = 16_384
const BLOCK_SIZE = 8
const PARALLELISM = 1
const KEY_LENGTH = 64
const SALT_LENGTH = 16
const MAX_MEMORY = 64 * 1024 * 1024

/** Twelve characters is the floor the settings screen and the installer both enforce; scrypt makes length matter more. */
export const MIN_PASSWORD_LENGTH = 12

/** Far above anything a person types, and the ceiling keeps one request from spending minutes of CPU. */
const MAX_PASSWORD_LENGTH = 200

const derive = (password: string, salt: Buffer, cost: number, blockSize: number, parallelism: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: cost, r: blockSize, p: parallelism, maxmem: MAX_MEMORY },
      (error, key) => {
        if (error === null) resolve(key)
        else reject(error)
      },
    )
  })

/** A password of the wrong length is the caller's mistake, so it answers 400 rather than reaching the 500 handler. */
const invalidPassword = (message: string): AppError =>
  new AppError(message, { statusCode: 400, code: 'auth.invalid_password' })

/** `scrypt$cost$blockSize$parallelism$salt$key`, all base64url after the algorithm name. */
export const hashPassword = async (password: string): Promise<string> => {
  checkLength(password)
  const salt = randomBytes(SALT_LENGTH)
  const key = await derive(password, salt, COST, BLOCK_SIZE, PARALLELISM)

  return [
    'scrypt',
    String(COST),
    String(BLOCK_SIZE),
    String(PARALLELISM),
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

/**
 * `false` for anything unreadable: a malformed hash is a row nobody can sign in with, and reporting it as a wrong
 * password keeps the response identical to every other failure.
 */
export const verifyPassword = async (stored: string, password: string): Promise<boolean> => {
  if (password.length > MAX_PASSWORD_LENGTH) return false

  const [algorithm, cost, blockSize, parallelism, salt, key] = stored.split('$')
  if (algorithm !== 'scrypt' || salt === undefined || key === undefined) return false

  const expected = Buffer.from(key, 'base64url')
  const actual = await derive(
    password,
    Buffer.from(salt, 'base64url'),
    Number(cost),
    Number(blockSize),
    Number(parallelism),
  )

  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/**
 * A generated password the installer prints once. base64url keeps it shell-safe, and 18 bytes is 144 bits — long enough
 * that the second factor is not the only thing standing between a leaked log and an account.
 */
export const generatePassword = (): string => randomBytes(18).toString('base64url')

export const checkPassword = (password: string): void => {
  checkLength(password)
}

const checkLength = (password: string): void => {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw invalidPassword(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw invalidPassword(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`)
  }
}
