/**
 * OAuth 2.1 avtorizatsiya serveri — claude.ai connector uchun.
 *
 * claude.ai custom connector qo'shilganda quyidagi oqim bo'ladi:
 *
 *   1. claude.ai `/.well-known/oauth-protected-resource` ni o'qiydi
 *   2. `/.well-known/oauth-authorization-server` dan endpoint'larni topadi
 *   3. `POST /register` — o'zini dinamik ro'yxatdan o'tkazadi (RFC 7591)
 *   4. `GET /authorize` — foydalanuvchini brauzerda bu yerga yuboradi
 *      → biz EzguTech login/parol formasini ko'rsatamiz
 *      → forma `POST /xpert-login` ga boradi, EzguTech'da tekshiriladi
 *      → muvaffaqiyatli bo'lsa `code` bilan claude.ai ga qaytariladi
 *   5. `POST /token` — code'ni access + refresh token'ga almashtiradi
 *   6. `POST /mcp` — Bearer token bilan, har so'rov o'sha foydalanuvchi
 *      nomidan EzguTech'ga boradi
 *
 * SDK'ning `mcpAuthRouter` metadata, /register, /authorize, /token, /revoke
 * endpoint'larini o'zi qo'yadi — bizga faqat quyidagi mantiq qoladi.
 *
 * SAQLASH: hammasi RAM'da. Server qayta ishga tushsa foydalanuvchilar qayta
 * kiradi. Parollar diskka YOZILMAYDI — bu ataylab shunday: ular faqat EzguTech
 * JWT'si muddati o'tganda (6 soat) qayta login uchun kerak.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import type { Response } from 'express'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import {
  InvalidGrantError,
  InvalidTokenError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { XpertError, XpertSession, createSession } from './xpert.js'
import { config } from './config.js'
import { loginPage } from './login-page.js'

// http.ts shu yerdan oladi — OAuth oqimi va sahifa bir joyda turishi uchun
export { loginPage }

const token = (): string => randomBytes(32).toString('base64url')

const log = (message: string): void => {
  process.stderr.write(`[xpert-mcp] ${message}\n`)
}

// ── Saqlash (RAM) ─────────────────────────────────────────────────────────────
const clients = new Map<string, OAuthClientInformationFull>()

/** `/authorize` boshlangan, lekin hali login qilinmagan so'rovlar */
interface PendingAuth {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state?: string
  scopes?: string[]
  resource?: string
  createdAt: number
}

const pending = new Map<string, PendingAuth>()

/** Login qilingan, `code` berilgan — `/token` da almashtirishga tayyor */
interface IssuedCode {
  clientId: string
  redirectUri: string
  codeChallenge: string
  session: XpertSession
  createdAt: number
}

const codes = new Map<string, IssuedCode>()

interface TokenRecord {
  clientId: string
  session: XpertSession
  scopes: string[]
  expiresAt: number
}

const accessTokens = new Map<string, TokenRecord>()
const refreshTokens = new Map<string, TokenRecord>()

const PENDING_TTL_MS = 10 * 60_000
const CODE_TTL_MS = 60_000

/** Muddati o'tganlarni tozalaydi — Map cheksiz o'smasligi uchun */
const sweep = (): void => {
  const now = Date.now()

  for (const [key, value] of pending) {
    if (now - value.createdAt > PENDING_TTL_MS) pending.delete(key)
  }
  for (const [key, value] of codes) {
    if (now - value.createdAt > CODE_TTL_MS) codes.delete(key)
  }
  for (const [key, value] of accessTokens) {
    if (value.expiresAt * 1000 <= now) accessTokens.delete(key)
  }
  for (const [key, value] of refreshTokens) {
    if (value.expiresAt * 1000 <= now) refreshTokens.delete(key)
  }
}

setInterval(sweep, 60_000).unref()

// ── Mijozlar do'koni ──────────────────────────────────────────────────────────
const clientsStore: OAuthRegisteredClientsStore = {
  async getClient(clientId) {
    return clients.get(clientId)
  },

  /**
   * Dinamik ro'yxat (RFC 7591). Kelgan obyektda `client_id` YO'Q — uni
   * biz yasashimiz kerak va to'liq obyektni qaytarishimiz kerak.
   */
  async registerClient(client) {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    }

    clients.set(full.client_id, full)
    log(`OAuth mijoz ro'yxatdan o'tdi: ${full.client_name ?? full.client_id}`)

    return full
  },
}

// ── Provider ──────────────────────────────────────────────────────────────────
export const provider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore
  },

  /**
   * Avtorizatsiya boshlandi. Bizning o'zimiz avtorizatsiya serveri bo'lganimiz
   * uchun foydalanuvchini o'z login formamizga yuboramiz.
   */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const authId = randomUUID()

    pending.set(authId, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scopes: params.scopes,
      resource: params.resource?.href,
      createdAt: Date.now(),
    })

    res
      .status(200)
      .setHeader('content-type', 'text/html; charset=utf-8')
      .setHeader('cache-control', 'no-store')
      .send(loginPage(authId))
  },

  async challengeForAuthorizationCode(client, authorizationCode) {
    const record = codes.get(authorizationCode)

    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError("Avtorizatsiya kodi yaroqsiz yoki muddati o'tgan")
    }

    return record.codeChallenge
  },

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri) {
    const record = codes.get(authorizationCode)

    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError("Avtorizatsiya kodi yaroqsiz yoki muddati o'tgan")
    }

    if (Date.now() - record.createdAt > CODE_TTL_MS) {
      codes.delete(authorizationCode)
      throw new InvalidGrantError("Avtorizatsiya kodining muddati o'tdi, qaytadan kiring")
    }

    if (redirectUri && redirectUri !== record.redirectUri) {
      throw new InvalidGrantError('redirect_uri mos kelmadi')
    }

    // Kod bir marta ishlatiladi
    codes.delete(authorizationCode)

    return issueTokens(client.client_id, record.session)
  },

  /**
   * Refresh. Access token 1 soat yashaydi, EzguTech JWT esa 6 soat — ikkalasi ham
   * shu yerda yangilanadi (saqlangan hisob bilan EzguTech'ga qayta kirib).
   */
  async exchangeRefreshToken(client, refreshToken) {
    const record = refreshTokens.get(refreshToken)

    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError("Refresh token yaroqsiz yoki muddati o'tgan")
    }

    if (record.expiresAt * 1000 <= Date.now()) {
      refreshTokens.delete(refreshToken)
      throw new InvalidGrantError("Refresh token muddati o'tdi, qaytadan kiring")
    }

    refreshTokens.delete(refreshToken)

    try {
      const fresh = await createSession(record.session.login, record.session.password)

      return issueTokens(client.client_id, fresh.session)
    } catch (err) {
      if (err instanceof XpertError && err.status === 401) {
        // Parol o'zgargan — foydalanuvchi qaytadan kirishi kerak
        throw new InvalidGrantError(
          "EzguTech hisobiga kirib bo'lmadi (parol o'zgargan bo'lishi mumkin). Connectorni qayta ulang.",
        )
      }
      throw new ServerError(err instanceof Error ? err.message : String(err))
    }
  },

  async verifyAccessToken(accessToken): Promise<AuthInfo> {
    const record = accessTokens.get(accessToken)

    if (!record) throw new InvalidTokenError('Access token yaroqsiz')

    if (record.expiresAt * 1000 <= Date.now()) {
      accessTokens.delete(accessToken)
      throw new InvalidTokenError("Access token muddati o'tgan")
    }

    return {
      token: accessToken,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      // Tool handler'lari shu yerdan sessiyani oladi (src/session.ts)
      extra: { session: record.session, login: record.session.login },
    }
  },

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const { token: value } = request

    const access = accessTokens.get(value)
    if (access && access.clientId === client.client_id) accessTokens.delete(value)

    const refresh = refreshTokens.get(value)
    if (refresh && refresh.clientId === client.client_id) refreshTokens.delete(value)
  },
}

const issueTokens = (clientId: string, session: XpertSession): OAuthTokens => {
  const accessToken = token()
  const refreshToken = token()
  const nowSec = Math.floor(Date.now() / 1000)

  accessTokens.set(accessToken, {
    clientId,
    session,
    scopes: ['xpert:read'],
    expiresAt: nowSec + config.accessTokenTtlSec,
  })

  refreshTokens.set(refreshToken, {
    clientId,
    session,
    scopes: ['xpert:read'],
    expiresAt: nowSec + config.refreshTokenTtlSec,
  })

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: config.accessTokenTtlSec,
    refresh_token: refreshToken,
    scope: 'xpert:read',
  }
}

// ── Login formasini qabul qilish ──────────────────────────────────────────────
export interface LoginOutcome {
  /** Muvaffaqiyatli — shu manzilga redirect qilinadi */
  redirectTo?: string
  /** Xato — forma qayta ko'rsatiladi */
  error?: string
  /** Forma qayta ko'rsatilganda kerak */
  authId: string
}

/**
 * `POST /xpert-login` mantiqi. EzguTech'da hisobni tekshiradi va muvaffaqiyatli
 * bo'lsa `code` bilan claude.ai ga qaytaradigan manzilni qaytaradi.
 */
export const completeLogin = async (
  authId: string,
  loginValue: string,
  password: string,
): Promise<LoginOutcome> => {
  const request = pending.get(authId)

  if (!request) {
    return {
      authId,
      error: "Avtorizatsiya so'rovi topilmadi yoki muddati o'tdi. claude.ai da qaytadan ulang.",
    }
  }

  if (Date.now() - request.createdAt > PENDING_TTL_MS) {
    pending.delete(authId)

    return { authId, error: "Avtorizatsiya so'rovi muddati o'tdi. claude.ai da qaytadan ulang." }
  }

  let session: XpertSession
  let userName: string | undefined

  try {
    const result = await createSession(loginValue, password)

    session = result.session
    userName = result.user.name ?? result.user.login
  } catch (err) {
    if (err instanceof XpertError) return { authId, error: err.message }

    return { authId, error: err instanceof Error ? err.message : String(err) }
  }

  pending.delete(authId)

  const code = token()

  codes.set(code, {
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    session,
    createdAt: Date.now(),
  })

  const redirect = new URL(request.redirectUri)

  redirect.searchParams.set('code', code)
  if (request.state) redirect.searchParams.set('state', request.state)

  log(`kirdi: ${loginValue}${userName ? ` (${userName})` : ''}`)

  return { authId, redirectTo: redirect.href }
}

/**
 * Shu login uchun tirik ulanish bormi?
 *
 * Access token 1 soat yashaydi va Claude uni doim yangilab turmaydi, shuning
 * uchun "ulangan" belgisi sifatida REFRESH token olinadi — u 30 kun yashaydi
 * va connector o'chirilmaguncha (yoki parol o'zgarmaguncha) saqlanadi.
 */
export const connectionFor = (
  loginValue: string,
): { connected: boolean; expiresAt: number | null } => {
  const needle = loginValue.trim().toLowerCase()
  let latest = 0

  for (const record of refreshTokens.values()) {
    if (record.session.login.trim().toLowerCase() !== needle) continue
    if (record.expiresAt * 1000 <= Date.now()) continue
    if (record.expiresAt > latest) latest = record.expiresAt
  }

  return { connected: latest > 0, expiresAt: latest || null }
}

/** Diagnostika uchun — /healthz da ko'rsatiladi */
export const stats = () => ({
  clients: clients.size,
  pending: pending.size,
  codes: codes.size,
  accessTokens: accessTokens.size,
  refreshTokens: refreshTokens.size,
})
