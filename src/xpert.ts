/**
 * EzguTech API mijozi.
 *
 * Vazifalari:
 *   - EzguTech'ga login qilib JWT olish
 *   - Bir xil so'rovni keshlash (Claude ko'p marta takrorlaydi)
 *   - Rate limit (model sikliga tushib qolsa serverni yiqitmasin)
 *   - Timeout (osilib qolgan so'rov MCP'ni bloklamasin)
 *   - Xatoni foydalanuvchi tushunadigan matnga aylantirish
 *
 * DIQQAT 1: bazaga to'g'ridan-to'g'ri ulanmaydi — faqat HTTP API orqali boradi.
 * Shu sabab company_id va ombor bo'yicha ajratish backenddagi holicha ishlaydi.
 *
 * DIQQAT 2: har so'rov O'SHA FOYDALANUVCHINING tokeni bilan ketadi. Kesh va
 * rate limit ham foydalanuvchi bo'yicha ajratilgan — birining ma'lumoti
 * boshqasiga ko'rinib qolmaydi. Umumiy "servis" tokeni ishlatilmaydi.
 */

import { config } from './config.js'

/** EzguTech javob konverti: { success, data, message } */
interface Envelope<T> {
  success?: boolean
  message?: string
  data?: T
}

export class XpertError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'XpertError'
  }
}

/**
 * Foydalanuvchi sessiyasi.
 *
 * `password` faqat RAM'da turadi va faqat bitta maqsad uchun ishlatiladi:
 * EzguTech JWT'si muddati o'tganda (6 soat) qayta login qilish. Diskka
 * yozilmaydi — server qayta ishga tushsa foydalanuvchi qaytadan kiradi.
 */
export interface XpertSession {
  login: string
  password: string
  /** Joriy EzguTech JWT — muddati o'tsa avtomatik yangilanadi */
  token: string
}

export interface XpertUser {
  id?: number
  name?: string
  login?: string
  warehouse_id?: number | null
  role?: { name?: string; is_main?: number | boolean }
  company?: { name?: string }
}

// ── HTTP asoslari ─────────────────────────────────────────────────────────────
const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new XpertError(
        `So'rov ${config.timeoutMs / 1000} soniyada javob bermadi. ` +
          `Sana oralig'ini qisqartirib ko'ring.`,
      )
    }
    throw new XpertError(
      `EzguTech serveriga ulanib bo'lmadi: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

const buildUrl = (path: string, query: Record<string, unknown>): string => {
  const url = new URL(`${config.apiUrl}${path}`)

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }

  return url.toString()
}

// ── Login ─────────────────────────────────────────────────────────────────────
/**
 * EzguTech'ga kiradi va JWT + foydalanuvchi ma'lumotini qaytaradi.
 * OAuth login formasi ham, JWT yangilash ham shuni ishlatadi.
 */
export const login = async (
  loginValue: string,
  password: string,
): Promise<{ token: string; user: XpertUser }> => {
  const response = await fetchWithTimeout(`${config.apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ login: loginValue, password }),
  })

  const body = (await response.json().catch(() => null)) as Envelope<{
    access_token?: string
    user?: XpertUser
  }> | null

  if (!response.ok || !body?.data?.access_token) {
    throw new XpertError(
      body?.message ?? `EzguTech'ga kirish muvaffaqiyatsiz (HTTP ${response.status})`,
      response.status,
    )
  }

  return { token: body.data.access_token, user: body.data.user ?? {} }
}

export const createSession = async (
  loginValue: string,
  password: string,
): Promise<{ session: XpertSession; user: XpertUser }> => {
  const { token, user } = await login(loginValue, password)

  return { session: { login: loginValue, password, token }, user }
}

/**
 * EzguTech JWT'sini tekshiradi va egasini qaytaradi (yaroqsiz bo'lsa null).
 *
 * `GET /connection-status` uchun kerak: CRM foydalanuvchisining o'z tokenini
 * yuboradi, biz esa u haqiqatan kim ekanini EzguTech'dan so'raymiz. Shu tarzda
 * bu server hech kimning ulanish holatini begonaga ko'rsatmaydi — faqat
 * so'rovchining o'ziniki haqida javob beradi.
 */
export const whoAmI = async (bearerToken: string): Promise<XpertUser | null> => {
  try {
    const response = await fetchWithTimeout(`${config.apiUrl}/auth/me`, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${bearerToken}` },
    })

    if (!response.ok) return null

    const body = (await response.json().catch(() => null)) as Envelope<XpertUser> | null

    return body?.data ?? null
  } catch {
    // Tarmoq xatosi — "aniqlab bo'lmadi", "ulanmagan" emas
    return null
  }
}

// ── Kesh (foydalanuvchi bo'yicha ajratilgan) ──────────────────────────────────
interface CacheEntry {
  expiresAt: number
  value: unknown
}

const cache = new Map<string, CacheEntry>()

/**
 * Kalitga login ham kiradi — bu XAVFSIZLIK talabi, optimizatsiya emas.
 * Loginsiz kalit bilan A foydalanuvchining javobi B ga qaytib ketardi.
 */
const cacheKey = (session: XpertSession, path: string, query: Record<string, unknown>): string => {
  const sorted = Object.keys(query)
    .sort()
    .map(k => `${k}=${String(query[k])}`)
    .join('&')

  return `${session.login}\u0000${path}?${sorted}`
}

const pruneCache = (now: number): void => {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
}

// ── Rate limit (foydalanuvchi bo'yicha, sirg'aluvchi oyna) ────────────────────
const hits = new Map<string, number[]>()

const checkRateLimit = (session: XpertSession): void => {
  const now = Date.now()
  const recent = (hits.get(session.login) ?? []).filter(t => now - t < config.rateLimitWindowMs)

  if (recent.length >= config.rateLimitMax) {
    const oldest = recent[0] ?? now
    const waitSec = Math.ceil((config.rateLimitWindowMs - (now - oldest)) / 1000)

    hits.set(session.login, recent)

    throw new XpertError(
      `So'rovlar chegarasi oshdi (${config.rateLimitMax} / ${config.rateLimitWindowMs / 1000}s). ` +
        `${waitSec} soniyadan keyin qayta urinib ko'ring yoki so'rovni ixchamlashtiring.`,
    )
  }

  recent.push(now)
  hits.set(session.login, recent)
}

// ── GET ───────────────────────────────────────────────────────────────────────
/**
 * GET so'rovi. Faqat o'qish — bu server login'dan boshqa hech qachon
 * POST/PUT/DELETE qilmaydi, shuning uchun ma'lumotni o'zgartirib qo'yish
 * imkoni yo'q.
 */
export const get = async <T>(
  session: XpertSession,
  path: string,
  query: Record<string, unknown> = {},
): Promise<T> => {
  const key = cacheKey(session, path, query)
  const now = Date.now()

  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.value as T

  checkRateLimit(session)

  const url = buildUrl(path, query)

  const send = async (): Promise<Response> =>
    fetchWithTimeout(url, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${session.token}` },
    })

  let response = await send()

  // EzguTech JWT 6 soat yashaydi. Muddati o'tsa saqlangan hisob bilan bir marta
  // qayta login qilamiz — foydalanuvchi buni sezmaydi.
  if (response.status === 401) {
    const refreshed = await login(session.login, session.password)

    session.token = refreshed.token
    response = await send()
  }

  const body = (await response.json().catch(() => null)) as Envelope<T> | null

  if (!response.ok) {
    throw new XpertError(
      body?.message ?? `EzguTech API xatosi (HTTP ${response.status})`,
      response.status,
    )
  }

  if (body?.data === undefined) {
    throw new XpertError("EzguTech API bo'sh javob qaytardi")
  }

  pruneCache(now)
  cache.set(key, { expiresAt: now + config.cacheTtlMs, value: body.data })

  return body.data
}
