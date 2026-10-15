/**
 * `.env` faylini o'qish — tashqi paketsiz.
 *
 * Nega Node'ning `--env-file` bayrog'i emas:
 *   - `--env-file-if-exists` faqat Node 22+ da bor, `--env-file` esa 20.6+ da
 *     va fayl bo'lmasa yiqiladi. Serverdagi Node versiyasiga bog'lanib
 *     qolmaslik uchun o'zimiz o'qiymiz.
 *   - pm2, systemd va Docker `npm start` ni chetlab, to'g'ridan-to'g'ri
 *     `node dist/index.js` ni chaqiradi — bayroq umuman qo'llanmay qoladi.
 *
 * Ikki qoida:
 *   1. Fayl `dist/` ning yonidan emas, LOYIHA ILDIZIDAN qidiriladi — pm2 qaysi
 *      katalogdan ishga tushirsa ham topiladi.
 *   2. Muhitda allaqachon bor o'zgaruvchi USTIGA YOZILMAYDI — ya'ni pm2 /
 *      systemd / Docker bergan qiymat `.env` dan ustun turadi.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const parse = (content: string): Record<string, string> => {
  const result: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    if (!key) continue

    let value = line.slice(eq + 1).trim()

    // Tirnoq ichidagi qiymat: "..." yoki '...'
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))

    if (quoted && value.length >= 2) {
      value = value.slice(1, -1)
    } else {
      // Tirnoqsiz qiymatdan qatordagi izohni kesamiz: FOO=bar # izoh
      const hash = value.indexOf(' #')
      if (hash !== -1) value = value.slice(0, hash).trim()
    }

    result[key] = value
  }

  return result
}

export const loadEnvFile = (): void => {
  // dist/env.js → dist → loyiha ildizi
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const path = join(root, '.env')

  let content: string

  try {
    content = readFileSync(path, 'utf8')
  } catch {
    // .env yo'q — normal holat (pm2/systemd/Docker o'zgaruvchilarni o'zi beradi)
    return
  }

  for (const [key, value] of Object.entries(parse(content))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}
