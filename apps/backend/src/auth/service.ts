import type { Pool } from 'pg'

import { AppError } from '../errors.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'
import { LOCAL_USER_ID, LOCAL_USER_NAME } from '../threads/local-user.js'
import type { Actor, PendingStep } from './actor.js'
import { can } from './actor.js'
import type { Permission } from './permissions.js'
import { ALL_PERMISSIONS } from './permissions.js'
import { PermissionRepository, type RoleRecord } from './permission-repository.js'
import { checkPassword, generatePassword, hashPassword, verifyPassword } from './password.js'
import type { SecretBox } from './secret-box.js'
import type { SessionRecord } from './session-repository.js'
import { SessionRepository } from './session-repository.js'
import type { Settings } from './settings-repository.js'
import { SettingsRepository } from './settings-repository.js'
import { hashSessionToken, newSessionToken } from './session-token.js'
import { newTotpSecret, totpProvisioningUri, verifyTotp } from './totp.js'
import type { UserRecord } from './user-repository.js'
import { UserRepository } from './user-repository.js'

/** Thirty days: long enough that a browser is not asked twice a week, short enough that a lost laptop ages out. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Whether a second account may exist yet. The accounts are here, but every route still resolves the seeded owner, so a
 * second person would see the first one's workspaces and environments. The switch to single-user mode stays shut until
 * ownership is per request; it refuses rather than pretending.
 */
const MULTI_USER_WIRED = false

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/

export interface AuthDependencies {
  readonly pool: Pool
  readonly schema: PostgresSchema
  readonly secrets: SecretBox
}

export interface LoginResult {
  readonly token: string
  readonly actor: Actor
}

export interface CreatedUser {
  readonly user: UserRecord
  /** The password that was set, returned once so it can be handed over; only the hash is kept. */
  readonly password: string
}

export interface NewUserInput {
  readonly username: string
  readonly displayName: string
  readonly roleId: string
  readonly password?: string | undefined
}

/**
 * Everything that decides who a request is and what they may do. Routes call this and nothing else reads a session row,
 * so the difference between single-user mode and accounts lives here instead of in every handler.
 */
export class AuthService {
  readonly users: UserRepository
  readonly sessions: SessionRepository
  readonly permissions: PermissionRepository
  readonly settings: SettingsRepository
  readonly #secrets: SecretBox
  /** The settings are read on every request, so they are cached until the settings screen writes them. */
  #cached: Settings | undefined

  constructor(dependencies: AuthDependencies) {
    const { pool, schema } = dependencies
    this.#secrets = dependencies.secrets
    this.users = new UserRepository(pool, schema)
    this.sessions = new SessionRepository(pool, schema)
    this.permissions = new PermissionRepository(pool, schema)
    this.settings = new SettingsRepository(pool, schema)
  }

  async currentSettings(): Promise<Settings> {
    this.#cached ??= await this.settings.read()

    return this.#cached
  }

  /**
   * The identity of a request. In single-user mode there is no cookie to read and no session to expire: the owner is
   * everyone, holding every permission, which is exactly what this install did before accounts existed.
   */
  async resolve(token: string | undefined): Promise<Actor | undefined> {
    const settings = await this.currentSettings()
    if (settings.singleUser) return this.singleUserActor()

    if (token === undefined) return undefined

    const session = await this.sessions.findByTokenHash(hashSessionToken(token))
    if (session === undefined) return undefined

    const user = await this.users.findById(session.userId)
    if (user === undefined) return undefined

    if (user.disabled) {
      // Disabled while holding a cookie: the row goes, so the next request fails at the missing session instead.
      await this.sessions.remove(session.id)

      return undefined
    }

    await this.sessions.touch(session.id)

    return this.actorFor(user, session, settings)
  }

  async singleUserActor(): Promise<Actor> {
    const user = await this.users.findById(LOCAL_USER_ID)

    return {
      id: LOCAL_USER_ID,
      displayName: user?.displayName ?? LOCAL_USER_NAME,
      username: user?.username ?? null,
      permissions: new Set(ALL_PERMISSIONS),
      pending: null,
      sessionId: null,
      singleUser: true,
    }
  }

  /** A password on its own may leave the session half-signed-in; the caller gets the step that remains, not a boolean. */
  async login(username: string, password: string): Promise<LoginResult> {
    const settings = await this.currentSettings()
    if (settings.singleUser) {
      throw new AppError('This install has no accounts.', { statusCode: 404, code: 'auth.single_user' })
    }

    const user = await this.users.findByUsername(username)
    // One message and one status for every failure: a distinct "no such user" answers the only question a login form
    // is worth asking.
    const failed = new AppError('Wrong username or password.', { statusCode: 401, code: 'auth.invalid_credentials' })

    if (user === undefined || user.passwordHash === null) throw failed
    if (!(await verifyPassword(user.passwordHash, password))) throw failed
    if (user.disabled) throw new AppError('This account is disabled.', { statusCode: 403, code: 'auth.disabled' })

    const token = newSessionToken()
    const authenticated = this.pendingStep(user, settings) === null
    const session = await this.sessions.create(hashSessionToken(token), user.id, SESSION_TTL_MS, authenticated)

    return { token, actor: await this.actorFor(user, session, settings) }
  }

  async logout(sessionId: string | null): Promise<void> {
    if (sessionId !== null) await this.sessions.remove(sessionId)
  }

  async completeSecondFactor(actor: Actor, code: string): Promise<void> {
    const user = await this.requireUser(actor)
    const secret = this.openSecret(user)

    if (secret === undefined) {
      throw new AppError('No second factor is enrolled.', { statusCode: 409, code: 'auth.no_totp' })
    }
    if (!verifyTotp(secret, this.account(user), code)) {
      throw new AppError('That code is not valid.', { statusCode: 401, code: 'auth.invalid_code' })
    }

    if (actor.sessionId !== null) await this.sessions.markAuthenticated(actor.sessionId)
  }

  /** Enrolment hands the secret back once; the account only counts as protected after a code from it comes back. */
  async startTotpSetup(actor: Actor): Promise<{ readonly secret: string; readonly uri: string }> {
    const user = await this.requireUser(actor)
    const secret = newTotpSecret()

    await this.users.setTotpSecret(user.id, this.#secrets.seal(secret))

    return { secret, uri: totpProvisioningUri(secret, this.account(user)) }
  }

  async confirmTotp(actor: Actor, code: string): Promise<void> {
    const user = await this.requireUser(actor)
    const secret = this.openSecret(user)

    if (secret === undefined) {
      throw new AppError('Start the setup first.', { statusCode: 409, code: 'auth.no_totp' })
    }
    if (!verifyTotp(secret, this.account(user), code)) {
      throw new AppError('That code is not valid.', { statusCode: 401, code: 'auth.invalid_code' })
    }

    await this.users.confirmTotp(user.id)
    // The session was half-signed-in precisely because the second factor was missing.
    if (actor.sessionId !== null) await this.sessions.markAuthenticated(actor.sessionId)
  }

  /** Turning the second factor off is password-guarded: the thing being weakened protects this very account. */
  async disableTotp(actor: Actor, password: string): Promise<void> {
    const user = await this.requireUser(actor)
    await this.assertPassword(user, password)

    await this.users.setTotpSecret(user.id, null)
    await this.sessions.removeForUser(user.id)
  }

  async changePassword(actor: Actor, current: string, next: string): Promise<void> {
    const user = await this.requireUser(actor)
    await this.assertPassword(user, current)
    checkPassword(next)

    await this.users.setPassword(user.id, await hashPassword(next), false)
    // Every other device is signed out; the one that made the change stays where it is.
    await this.sessions.removeForUser(user.id, { sessionId: actor.sessionId ?? undefined })
  }

  /** The first sign-in after an admin created or reset the account: the password just typed is the current one. */
  async setInitialPassword(actor: Actor, next: string): Promise<void> {
    const user = await this.requireUser(actor)
    if (!user.mustChangePassword) {
      throw new AppError('A password is already set.', { statusCode: 409, code: 'auth.no_change_required' })
    }

    checkPassword(next)
    await this.users.setPassword(user.id, await hashPassword(next), false)
  }

  async createUser(input: NewUserInput): Promise<CreatedUser> {
    const username = input.username.trim().toLowerCase()
    if (!USERNAME_PATTERN.test(username)) {
      throw new AppError(
        'A username is 3 to 32 characters of lowercase letters, digits, dots, dashes or underscores.',
        { statusCode: 400, code: 'auth.invalid_username' },
      )
    }

    const role = await this.permissions.role(input.roleId)
    if (role === undefined) throw new AppError('No such role.', { statusCode: 404, code: 'auth.no_role' })

    const password = input.password ?? generatePassword()
    const displayName = input.displayName.trim() === '' ? username : input.displayName.trim()

    const user = await this.users.create({
      username,
      displayName,
      passwordHash: await hashPassword(password),
      roleId: role.id,
      // An admin-chosen password is known to the admin as well, so the first thing the new account does is replace it.
      mustChangePassword: true,
    })

    return { user, password }
  }

  /** The only account recovery there is: a new password, no second factor, and every session gone. */
  async resetUser(actor: Actor, userId: string): Promise<CreatedUser> {
    if (userId === actor.id) {
      throw new AppError('Change your own password instead.', { statusCode: 409, code: 'auth.self' })
    }

    const user = await this.users.findById(userId)
    if (user === undefined) throw new AppError('No such user.', { statusCode: 404, code: 'auth.no_user' })

    const password = generatePassword()
    await this.users.setPassword(user.id, await hashPassword(password), true)
    await this.users.setTotpSecret(user.id, null)
    await this.sessions.removeForUser(user.id)

    return { user: { ...user, mustChangePassword: true, totpSecret: null, totpConfirmedAt: null }, password }
  }

  async setRole(actor: Actor, userId: string, roleId: string): Promise<void> {
    if (userId === actor.id) {
      throw new AppError('You cannot change your own role.', { statusCode: 409, code: 'auth.self' })
    }

    const role = await this.permissions.role(roleId)
    if (role === undefined) throw new AppError('No such role.', { statusCode: 404, code: 'auth.no_role' })

    const user = await this.users.findById(userId)
    if (user === undefined) throw new AppError('No such user.', { statusCode: 404, code: 'auth.no_user' })

    if (!role.grantsAll) await this.requireAnotherAdmin(user.id)

    await this.users.setRole(user.id, role.id)
    // Permissions are read per request, but a cookie issued under the old role should not outlive it either.
    await this.sessions.removeForUser(user.id)
  }

  async setDisabled(actor: Actor, userId: string, disabled: boolean): Promise<void> {
    if (userId === actor.id) {
      throw new AppError('You cannot disable yourself.', { statusCode: 409, code: 'auth.self' })
    }

    const user = await this.users.findById(userId)
    if (user === undefined) throw new AppError('No such user.', { statusCode: 404, code: 'auth.no_user' })

    if (disabled) await this.requireAnotherAdmin(user.id)

    await this.users.setDisabled(user.id, disabled)
    if (disabled) await this.sessions.removeForUser(user.id)
  }

  /**
   * The settings, with the one rule that protects the install from itself: accounts can only be switched on when the
   * caller could sign back in afterwards, because the moment single-user mode ends, permissions start to matter.
   */
  async updateSettings(actor: Actor, patch: Partial<Settings>): Promise<Settings> {
    if (patch.singleUser === false) {
      if (!MULTI_USER_WIRED) {
        throw new AppError('Accounts need per-user ownership first; single-user mode cannot be switched off yet.', {
          statusCode: 409,
          code: 'auth.accounts_pending',
        })
      }

      const user = await this.users.findById(actor.id)
      const settings = await this.currentSettings()

      if (user?.passwordHash === null || user?.passwordHash === undefined) {
        throw new AppError('Set a password before turning single-user mode off.', {
          statusCode: 409,
          code: 'auth.no_password',
        })
      }
      if (settings.requireTwoFactor && user.totpConfirmedAt === null) {
        throw new AppError('This install requires a second factor: enrol one first.', {
          statusCode: 409,
          code: 'auth.no_totp',
        })
      }
    }

    const settings = await this.settings.write(patch)
    this.#cached = settings

    // Both directions change what an existing cookie means, so none of them survive the change.
    if (patch.singleUser !== undefined) await this.sessions.removeAll()

    return settings
  }

  /** The permissions a person ends up with: their role, plus their grants, minus their denies. */
  async effectivePermissions(user: UserRecord): Promise<ReadonlySet<Permission>> {
    if (user.grantsAll) return new Set(ALL_PERMISSIONS)
    if (user.roleId === null) return new Set()

    const role = await this.permissions.permissionsOfRole(user.roleId)
    const overrides = await this.permissions.overridesOf(user.id)
    const effective = new Set<Permission>(role)

    for (const permission of overrides.granted) effective.add(permission)
    for (const permission of overrides.denied) effective.delete(permission)

    return effective
  }

  roles(): Promise<readonly RoleRecord[]> {
    return this.permissions.roles()
  }

  user(id: string): Promise<UserRecord | undefined> {
    return this.users.findById(id)
  }

  userList(): Promise<readonly UserRecord[]> {
    return this.users.list()
  }

  /** Whether a second factor is enrolled, without handing the sealed value to a caller that only draws a screen. */
  static totpEnabled(user: UserRecord): boolean {
    return user.totpConfirmedAt !== null
  }

  /** The actor a stored session resolves to, permissions included — or none at all while a step remains. */
  private async actorFor(user: UserRecord, session: SessionRecord, settings: Settings): Promise<Actor> {
    const pending = session.authenticatedAt === null ? this.pendingStep(user, settings) : null

    return {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      // A half-signed-in session holds nothing: what it may do is the few routes that finish signing in.
      permissions: pending === null ? await this.effectivePermissions(user) : new Set<Permission>(),
      pending,
      sessionId: session.id,
      singleUser: false,
    }
  }

  /**
   * Which step remains, read from the rows rather than kept in a column: a password an admin chose has to be replaced, a
   * required second factor has to be enrolled, an enrolled one has to be presented.
   */
  private pendingStep(user: UserRecord, settings: Settings): PendingStep | null {
    if (user.mustChangePassword) return 'password'
    if (settings.requireTwoFactor && user.totpConfirmedAt === null) return 'totp-setup'
    if (user.totpConfirmedAt !== null) return 'totp'

    return null
  }

  private account(user: UserRecord): string {
    return user.username ?? user.displayName
  }

  private async assertPassword(user: UserRecord, password: string): Promise<void> {
    if (user.passwordHash === null || !(await verifyPassword(user.passwordHash, password))) {
      throw new AppError('Wrong password.', { statusCode: 401, code: 'auth.invalid_credentials' })
    }
  }

  private async requireUser(actor: Actor): Promise<UserRecord> {
    const user = await this.users.findById(actor.id)
    if (user === undefined) throw new AppError('No such user.', { statusCode: 404, code: 'auth.no_user' })

    return user
  }

  private openSecret(user: UserRecord): string | undefined {
    return user.totpSecret === null ? undefined : this.#secrets.open(user.totpSecret)
  }

  /** Removing the last admin would lock the install out of its own settings, so it is refused. */
  private async requireAnotherAdmin(userId: string): Promise<void> {
    const target = await this.users.findById(userId)
    if (target === undefined || !target.grantsAll) return

    const others = await this.users.list()
    const remaining = others.filter((user) => user.id !== userId && user.grantsAll && !user.disabled)
    if (remaining.length > 0) return

    throw new AppError('That is the last admin: give someone else the admin role first.', {
      statusCode: 409,
      code: 'auth.last_admin',
    })
  }

  static assertSignedIn(actor: Actor): void {
    if (actor.pending !== null) {
      throw new AppError('Finish signing in first.', { statusCode: 401, code: 'auth.pending' })
    }
  }

  static assertCan(actor: Actor, permission: Permission): void {
    if (!can(actor, permission)) {
      throw new AppError('You may not do that.', { statusCode: 403, code: 'auth.forbidden' })
    }
  }
}
