/**
 * Sana bilan ishlash va oraliqni cheklash.
 *
 * Nega cheklov kerak: model "bu yil qanday ketdi?" degan savolda butun yilni
 * so'rashga moyil. `/reports/account-operations` har hisob uchun 4 ta
 * korrelyatsiyalangan agregat subquery bajaradi (sub-hisoblar uchun yana 4 ta),
 * shuning uchun keng oraliq bazani sezilarli yuklaydi. Cheklovni model ko'radi
 * va so'rovni o'zi bo'lib-bo'lib yuboradi.
 */

import { config } from './config.js'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export const today = (): string => {
  const d = new Date()

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

const parseIso = (value: string, field: string): Date => {
  if (!ISO_DATE.test(value)) {
    throw new ValidationError(`${field} YYYY-MM-DD formatida bo'lishi kerak, berilgani: "${value}"`)
  }

  const date = new Date(`${value}T00:00:00Z`)

  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${field} mavjud sana emas: "${value}"`)
  }

  // "2026-02-31" kabi holatlar: Date uni 03-03 ga aylantiradi — qaytib solishtiramiz
  if (date.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`${field} mavjud sana emas: "${value}"`)
  }

  return date
}

export interface DateRange {
  from_date: string
  to_date: string
  /** Oraliqdagi kunlar soni (ikki chegara ham qo'shilgan) */
  days: number
}

/**
 * Oraliqni tekshiradi va normallashtiradi.
 * Ikkalasi ham berilmasa — bugungi kun.
 */
export const resolveRange = (from?: string, to?: string): DateRange => {
  const fromValue = from?.trim() || today()
  const toValue = to?.trim() || fromValue

  const fromDate = parseIso(fromValue, 'from_date')
  const toDate = parseIso(toValue, 'to_date')

  if (toDate < fromDate) {
    throw new ValidationError(
      `to_date (${toValue}) from_date (${fromValue}) dan kichik bo'lishi mumkin emas.`,
    )
  }

  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1

  if (days > config.maxRangeDays) {
    throw new ValidationError(
      `Sana oralig'i juda uzun: ${days} kun (ruxsat etilgani ${config.maxRangeDays} kun). ` +
        `Bu chegara bazani og'ir agregat so'rovlardan saqlaydi. ` +
        `Oraliqni bo'lib, har qismini alohida so'rang va natijalarni o'zingiz jamlang.`,
    )
  }

  return { from_date: fromValue, to_date: toValue, days }
}

/** Faqat sana kerak bo'lgan joyda vaqt qismini kesib tashlaydi: 2026-08-10T00:00:00Z → 10.08.2026 */
export const formatDate = (value: unknown): string => {
  if (typeof value !== 'string' || value.length < 10) return '—'

  const [y, m, d] = value.slice(0, 10).split('-')
  if (!y || !m || !d) return '—'

  return `${d}.${m}.${y}`
}

/**
 * Sana + soat:daqiqa: 2026-08-10 14:37:02 → 10.08.2026 14:37
 *
 * EzguTech API vaqtni mahalliy zonada, `Y-m-d H:i:s` ko'rinishida beradi
 * (`BaseModel::serializeDate`) — shuning uchun hech qanday zona o'girish
 * qilinmaydi, matn o'zi kesib olinadi. Vaqt qismi bo'lmasa faqat sana qaytadi.
 */
export const formatDateTime = (value: unknown): string => {
  const date = formatDate(value)

  if (date === '—' || typeof value !== 'string') return date

  const time = value.slice(11, 16)

  return /^\d{2}:\d{2}$/.test(time) ? `${date} ${time}` : date
}
