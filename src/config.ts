/**
 * Sozlamalar — hammasi muhit o'zgaruvchilaridan o'qiladi va bir joyda tekshiriladi.
 * Xato sozlama bilan ishga tushmaslik, keyin runtime'da yiqilishdan yaxshiroq.
 *
 * Ikki rejim:
 *   stdio — Claude Code / Claude Desktop. Bitta foydalanuvchi, login .env dan.
 *   http  — claude.ai connector. Ko'p foydalanuvchi, har biri OAuth orqali
 *           o'z EzguTech hisobi bilan kiradi.
 */

import { loadEnvFile } from './env.js'

// Sozlamalarni o'qishdan OLDIN .env yuklanadi. Muhitda bor qiymatlar
// ustun turadi, shuning uchun pm2/systemd/Docker bilan ham to'g'ri ishlaydi.
loadEnvFile()

const env = (name: string): string | undefined => process.env[name]?.trim() || undefined

const required = (name: string, why = ''): string => {
  const value = env(name)

  if (!value) {
    throw new Error(
      `Muhit o'zgaruvchisi ko'rsatilmagan: ${name}${why ? ` (${why})` : ''}. ` +
        `.env faylini .env.example dan nusxa olib to'ldiring.`,
    )
  }

  return value
}

const num = (name: string, fallback: number): number => {
  const raw = env(name)
  if (!raw) return fallback

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} musbat son bo'lishi kerak, berilgani: "${raw}"`)
  }

  return parsed
}

/** Vergul bilan ajratilgan ro'yxat: "a, b" → ['a', 'b'] */
const list = (name: string): readonly string[] => {
  const raw = env(name)
  if (!raw) return []

  return raw
    .split(',')
    .map(part => part.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

const transport = (env('XPERT_TRANSPORT') ?? 'http').toLowerCase()

if (transport !== 'http' && transport !== 'stdio') {
  throw new Error(`XPERT_TRANSPORT 'http' yoki 'stdio' bo'lishi kerak, berilgani: "${transport}"`)
}

export const config = {
  transport: transport as 'http' | 'stdio',

  /** Masalan: https://api.ezgutech.uz/api/v1 (oxirida / bo'lsa ham ishlaydi) */
  apiUrl: required('XPERT_API_URL').replace(/\/+$/, ''),

  // ── stdio rejimi ────────────────────────────────────────────────────────────
  /** stdio rejimida majburiy; http rejimida ishlatilmaydi (har kim o'zi kiradi) */
  login: transport === 'stdio' ? required('XPERT_LOGIN', 'stdio rejimi') : env('XPERT_LOGIN'),
  password:
    transport === 'stdio' ? required('XPERT_PASSWORD', 'stdio rejimi') : env('XPERT_PASSWORD'),

  // ── http rejimi ─────────────────────────────────────────────────────────────
  port: num('PORT', 8788),

  /**
   * Serverning INTERNETDAN ko'rinadigan manzili — OAuth metadata va redirect
   * uchun aynan shu ishlatiladi. Tunnel bilan sinaganda tunnel manzili
   * yoziladi, masalan https://xpert-mcp.trycloudflare.com
   */
  publicUrl:
    transport === 'http'
      ? required('XPERT_PUBLIC_URL', 'http rejimi — OAuth manzillari uchun').replace(/\/+$/, '')
      : '',

  /**
   * Server oldida nechta ishonchli proxy turadi (nginx, cloudflared, ...).
   * Bu son real IP'ni aniqlash uchun ishlatiladi — rate limit shunga tayanadi.
   * `true` qo'yish xavfli: soxta X-Forwarded-For bilan chegarani chetlab o'tiladi.
   */
  trustProxyHops: num('TRUST_PROXY_HOPS', 1),

  /** OAuth access token muddati (soniya). EzguTech JWT 6 soat yashaydi. */
  accessTokenTtlSec: num('XPERT_ACCESS_TOKEN_TTL_SEC', 3_600),

  /** OAuth refresh token muddati (soniya). Shu muddat ichida qayta login shart emas. */
  refreshTokenTtlSec: num('XPERT_REFRESH_TOKEN_TTL_SEC', 30 * 24 * 3_600),

  // ── Yuklamani cheklash ──────────────────────────────────────────────────────
  /**
   * Bir xil so'rov shu muddat ichida takrorlansa, API'ga bormaydi.
   * Kesh kaliti FOYDALANUVCHI bo'yicha ajratilgan — birining ma'lumoti
   * boshqasiga ko'rinmaydi.
   */
  cacheTtlMs: num('XPERT_CACHE_TTL_MS', 90_000),

  /** Rate limit: har foydalanuvchi uchun oynadagi maksimal so'rov soni */
  rateLimitMax: num('XPERT_RATE_LIMIT_MAX', 20),
  rateLimitWindowMs: num('XPERT_RATE_LIMIT_WINDOW_MS', 60_000),

  /** Bitta HTTP so'rovi uchun timeout — hisobotlar sekin bo'lishi mumkin */
  timeoutMs: num('XPERT_TIMEOUT_MS', 30_000),

  /**
   * Sana oralig'ining maksimal uzunligi (kun).
   * Claude "bu yil qanday ketdi?" deb butun yilni so'rashga moyil — cheklov
   * bazani og'ir agregat so'rovlardan saqlaydi.
   */
  maxRangeDays: num('XPERT_MAX_RANGE_DAYS', 366),

  /** Ro'yxat qaytaradigan tool'lar uchun maksimal qator soni */
  maxRows: num('XPERT_MAX_ROWS', 50),

  /**
   * `GET /connection-status` ni brauzerdan chaqira oladigan manbalar (origin).
   * EzguTech CRM shu endpoint orqali "Claude ulanganmi?" degan savolga javob oladi.
   * Vergul bilan ajratiladi; bo'sh bo'lsa endpoint brauzerdan chaqirilmaydi
   * (CORS sarlavhasi qo'yilmaydi) — bu ataylab shunday: ruxsat aniq berilsin.
   */
  statusOrigins: list('XPERT_STATUS_ORIGINS'),
} as const

export type Config = typeof config
