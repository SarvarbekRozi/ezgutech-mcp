/**
 * Javobni modelga qulay ko'rinishda tayyorlash.
 *
 * Ikki qoida bu faylning butun mazmuni:
 *
 * 1. VALYUTALAR QO'SHILMAYDI. EzguTech'da hisoblar so'mda ham, dollarda ham
 *    bo'ladi. So'm va dollarni bitta "jami" ga qo'shish ma'nosiz raqam beradi
 *    (1 000 000 so'm + 150 $ = 1 000 150 kabi). Har valyuta alohida yig'iladi.
 *
 * 2. ARIFMETIKA MODELGA QOLDIRILMAYDI. Xom qatorlarni tashlab "o'zi qo'shsin"
 *    deyish — kontekstni to'ldiradi va xato natija beradi. Jami summalarni
 *    shu yerda (yoki API'ning `totals=` imkoniyati bilan) hisoblab beramiz.
 */

import { config } from './config.js'

export const CURRENCY_SUFFIX: Record<string, string> = {
  uzs: "so'm",
  usd: '$',
}

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export const toNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(n) ? n : 0
}

/** 1234567.5 → "1,234,567.5 so'm" */
export const money = (value: unknown, currency?: string | null): string => {
  const cur = (currency ?? 'uzs').toLowerCase()
  const suffix = CURRENCY_SUFFIX[cur] ?? cur.toUpperCase()

  return `${numberFormatter.format(toNumber(value))} ${suffix}`
}

export const plain = (value: unknown): string => numberFormatter.format(toNumber(value))

/**
 * Valyuta bo'yicha yig'uvchi. Kalit — valyuta kodi, qiymat — nomlangan summalar.
 * So'm birinchi, keyin dollar, keyin qolganlari alifbo bo'yicha.
 */
export class CurrencyTotals<K extends string> {
  private readonly buckets = new Map<string, Record<K, number>>()

  constructor(private readonly fields: readonly K[]) {}

  add(currency: string | null | undefined, values: Partial<Record<K, unknown>>): void {
    const cur = (currency ?? 'uzs').toLowerCase()

    let bucket = this.buckets.get(cur)
    if (!bucket) {
      bucket = Object.fromEntries(this.fields.map(f => [f, 0])) as Record<K, number>
      this.buckets.set(cur, bucket)
    }

    for (const field of this.fields) {
      bucket[field] += toNumber(values[field])
    }
  }

  rows(): Array<{ currency: string; values: Record<K, number> }> {
    const order = ['uzs', 'usd']

    return [...this.buckets.entries()]
      .sort(([a], [b]) => {
        const ai = order.indexOf(a)
        const bi = order.indexOf(b)

        if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)

        return a.localeCompare(b)
      })
      .map(([currency, values]) => ({ currency, values }))
  }

  isEmpty(): boolean {
    return this.buckets.size === 0
  }
}

// ── Markdown jadval ───────────────────────────────────────────────────────────
export interface Column<T> {
  header: string
  /** 'right' — raqamlar uchun */
  align?: 'left' | 'right'
  value: (row: T) => string
}

export const table = <T>(rows: readonly T[], columns: readonly Column<T>[]): string => {
  if (!rows.length) return '_(qator yo\'q)_'

  const head = `| ${columns.map(c => c.header).join(' | ')} |`
  const sep = `| ${columns.map(c => (c.align === 'right' ? '---:' : ':---')).join(' | ')} |`
  const body = rows.map(row => `| ${columns.map(c => c.value(row)).join(' | ')} |`)

  return [head, sep, ...body].join('\n')
}

/**
 * Ro'yxatni kesadi va NECHTASI QOLGANINI aniq aytadi.
 * Jimgina kesish — eng yomon variant: model to'liq ma'lumot ko'rgan deb o'ylaydi.
 */
export const limitRows = <T>(
  rows: readonly T[],
  total?: number,
): { shown: readonly T[]; note: string | null } => {
  const totalCount = total ?? rows.length

  if (rows.length <= config.maxRows && totalCount <= rows.length) {
    return { shown: rows, note: null }
  }

  const shown = rows.slice(0, config.maxRows)
  const omitted = totalCount - shown.length

  return {
    shown,
    note:
      omitted > 0
        ? `_Ko'rsatilgan: ${shown.length} ta, jami topilgani: ${totalCount} ta ` +
          `(${omitted} ta qator ko'rsatilmadi — filtrni aniqlashtiring)._`
        : null,
  }
}

/** MCP tool javobi */
export const text = (...parts: Array<string | null | undefined>) => ({
  content: [{ type: 'text' as const, text: parts.filter(Boolean).join('\n\n') }],
})
