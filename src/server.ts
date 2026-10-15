/**
 * MCP server nusxasini yasash. stdio va http ikkalasi ham shuni ishlatadi —
 * tool'lar va ko'rsatmalar transportga bog'liq emas.
 *
 * http rejimida har MCP sessiyasi uchun alohida nusxa yasaladi.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools } from './tools.js'

/**
 * Modelga beriladigan umumiy ko'rsatmalar.
 *
 * Bu shunchaki "yaxshi bo'lsin" degan matn emas — bu sessiyada topilgan
 * ikki haqiqiy xatoni oldini oladi: valyutalarni qo'shib yuborish va
 * xom qatorlardan o'zi jami hisoblash.
 */
const INSTRUCTIONS =
  "EZGUTECH CRM tizimining hisobotlariga faqat o'qish uchun kirish.\n\n" +
  'Muhim qoidalar:\n' +
  "1. So'm (UZS) va dollar (USD) summalarini HECH QACHON qo'shmang — ular " +
  "alohida valyutalar, tool javobida ham jamilari alohida keladi.\n" +
  '2. Jami summalarni jadval qatorlaridan o\'zingiz qo\'shib hisoblamang — ' +
  'javobdagi tayyor "Jami" qatorlaridan foydalaning. Ular butun filtr ' +
  "natijasiga tegishli, ko'rsatilgan qatorlarga emas.\n" +
  "3. Filial yoki ombor nomi aytilsa, avval `omborlar` tool'i bilan ID ni " +
  "topib, keyin kerakli tool'ga `warehouse_id` sifatida bering. Xuddi shunday " +
  "hisob nomi uchun `hisoblar`.\n" +
  "4. Javobda qatorlar kesilgani aytilsa, natija to'liq emas — buni " +
  "foydalanuvchiga ayting yoki filtrni aniqlashtirib qayta so'rang.\n" +
  "5. Sana oralig'i uzun bo'lsa tool rad etadi. Bunda oraliqni oylarga bo'lib " +
  "alohida so'rang.\n" +
  "6. Ruxsat yo'q degan javob kelsa, boshqa tool bilan aylanib o'tishga " +
  'urinmang — foydalanuvchiga ruxsat kerakligini ayting.\n' +
  "7. BEKOR QILINGAN yozuvlar (shartnoma, savdo, qarz) hisobotga kirmaydi: " +
  "ular amalga oshmagan, tovar omborga va pul mijozga qaytarilgan. Tool'lar " +
  "ularni o'zi chiqarib tashlaydi — javobda \"bekor qilingan\" deb belgilangan " +
  'qator ko\'rsangiz, uni jamiga, sotuv soniga yoki tushumga QO\'SHMANG.\n' +
  "8. Ombor qoldig'i va tovar harakati (moddiy hisobot) uchun tool yo'q. Bunday " +
  "savolda shartnoma yoki operatsiyalardan taxminiy hisob tuzmang — bu " +
  "ma'lumot hozircha Claude orqali ochilmaganini ayting."

export const buildServer = (): McpServer => {
  const server = new McpServer(
    { name: 'xpert', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  )

  registerTools(server)

  return server
}
