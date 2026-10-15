/**
 * Tool handler'iga kelgan `extra` dan foydalanuvchi sessiyasini ajratib olish.
 *
 * http rejimida sessiya OAuth access token'ga bog'langan (`oauth.ts` uni
 * `AuthInfo.extra.session` ga qo'yadi). stdio rejimida esa bitta global sessiya
 * bo'ladi — .env dagi hisob.
 *
 * Nega alohida fayl: `tools.ts` transport turini bilishi shart emas.
 */

import type { XpertSession } from './xpert.js'

/** Tool handler'ining ikkinchi argumenti (SDK: RequestHandlerExtra) */
interface HandlerExtra {
  authInfo?: {
    extra?: Record<string, unknown>
  }
}

/** stdio rejimida o'rnatiladi — bitta foydalanuvchi */
let fallbackSession: XpertSession | null = null

export const setFallbackSession = (session: XpertSession): void => {
  fallbackSession = session
}

export class NoSessionError extends Error {
  constructor() {
    super(
      "Bu so'rov uchun EzguTech sessiyasi topilmadi. " +
        'Connector qaytadan ulanishi kerak — claude.ai da EzguTech connectorini ' +
        "o'chirib, qayta ulang.",
    )
    this.name = 'NoSessionError'
  }
}

export const sessionFrom = (extra: HandlerExtra): XpertSession => {
  const fromToken = extra.authInfo?.extra?.session

  if (isSession(fromToken)) return fromToken

  if (fallbackSession) return fallbackSession

  throw new NoSessionError()
}

const isSession = (value: unknown): value is XpertSession =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as XpertSession).token === 'string' &&
  typeof (value as XpertSession).login === 'string'
