#!/usr/bin/env node
/**
 * EZGUTECH MCP server — kirish nuqtasi.
 *
 * XPERT_TRANSPORT=http  → claude.ai custom connector (OAuth, ko'p foydalanuvchi)
 * XPERT_TRANSPORT=stdio → Claude Code / Claude Desktop (bitta foydalanuvchi, .env)
 *
 * MUHIM (stdio): stdout — protokol kanali. Log faqat stderr'ga chiqadi,
 * aks holda JSON-RPC oqimi buziladi.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { toolErrorText } from './errors.js'
import { buildServer } from './server.js'

const log = (message: string): void => {
  process.stderr.write(`[xpert-mcp] ${message}\n`)
}

const startStdio = async (): Promise<void> => {
  const { config } = await import('./config.js')
  const { createSession } = await import('./xpert.js')
  const { setFallbackSession } = await import('./session.js')

  // stdio rejimida bitta foydalanuvchi — .env dagi hisob bilan darhol kiramiz,
  // shunda xato login/parol birinchi tool chaqiruvida emas, hoziroq ko'rinadi.
  const { session, user } = await createSession(config.login!, config.password!)

  setFallbackSession(session)

  const server = buildServer()
  const transport = new StdioServerTransport()

  await server.connect(transport)

  log(
    `stdio rejimida ishga tushdi · ${user.name ?? config.login}` +
      (user.company?.name ? ` · ${user.company.name}` : '') +
      (user.role?.name ? ` · ${user.role.name}` : ''),
  )
  log(
    `cheklovlar: oraliq ≤ ${config.maxRangeDays} kun, qator ≤ ${config.maxRows}, ` +
      `kesh ${config.cacheTtlMs / 1000}s, rate limit ${config.rateLimitMax}/${
        config.rateLimitWindowMs / 1000
      }s`,
  )
}

const main = async (): Promise<void> => {
  // config import qilinganda tekshiriladi — sozlama xato bo'lsa shu yerda yiqiladi
  const { config } = await import('./config.js')

  process.on('unhandledRejection', reason => {
    log(`unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`)
  })

  if (config.transport === 'http') {
    const { startHttp } = await import('./http.js')

    await startHttp()

    return
  }

  await startStdio()
}

main().catch((err: unknown) => {
  log(`ishga tushmadi: ${toolErrorText(err)}`)
  process.exit(1)
})
