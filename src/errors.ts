/**
 * Tool xatolarini modelga tushunarli matnga aylantirish.
 *
 * Nega kerak: SDK tashlangan xatoni `String(error)` bilan qaytaradi —
 * model "XpertError: Request failed with status 403" dan nima qilishni bilmaydi.
 * Bu yerda har xato turi uchun aniq, harakatga undaydigan matn beriladi.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { XpertError } from './xpert.js'
import { ValidationError } from './dates.js'
import { NoSessionError } from './session.js'

export const toolErrorText = (err: unknown): string => {
  if (err instanceof ValidationError) {
    return `Parametr xatosi: ${err.message}`
  }

  if (err instanceof NoSessionError) {
    return err.message
  }

  if (err instanceof XpertError) {
    switch (err.status) {
      case 401:
        return (
          `Autentifikatsiya xatosi: ${err.message}\n\n` +
          `.env dagi XPERT_LOGIN / XPERT_PASSWORD ni tekshiring.`
        )
      case 403:
        return (
          `Ruxsat yo'q: ${err.message}\n\n` +
          `Bu ma'lumot ushbu EzguTech hisobining ruxsatlari doirasiga kirmaydi. ` +
          `Foydalanuvchiga shuni ayting — ruxsatni tizim administratori beradi. ` +
          `Boshqa tool bilan aylanib o'tishga urinmang.`
        )
      case 404:
        return `Topilmadi: ${err.message}`
      case 422:
        return `Noto'g'ri so'rov: ${err.message}`
      default:
        return `EzguTech API xatosi: ${err.message}`
    }
  }

  return `Kutilmagan xato: ${err instanceof Error ? err.message : String(err)}`
}

/**
 * Handler'ni o'raydi: xato bo'lsa `isError: true` bilan tushunarli matn qaytaradi.
 * `isError` muhim — usiz model xatoni muvaffaqiyatli javob deb qabul qiladi.
 *
 * Qaytish turi SDK'ning `CallToolResult` iga bog'langan — o'z interfeysimizni
 * yozsak, SDK'dagi index signature bilan mos kelmaydi.
 */
export const safe =
  <A, E>(handler: (args: A, extra: E) => Promise<CallToolResult>) =>
  async (args: A, extra: E): Promise<CallToolResult> => {
    try {
      return await handler(args, extra)
    } catch (err) {
      process.stderr.write(
        `[xpert-mcp] tool xatosi: ${err instanceof Error ? err.stack : String(err)}\n`,
      )

      return {
        content: [{ type: 'text', text: toolErrorText(err) }],
        isError: true,
      }
    }
  }
