/**
 * HTTP transport — claude.ai custom connector uchun.
 *
 * Marshrutlar:
 *   /.well-known/oauth-*    OAuth metadata (mcpAuthRouter qo'yadi)
 *   POST /register          dinamik mijoz ro'yxati (mcpAuthRouter)
 *   GET  /authorize         login formasi (mcpAuthRouter → provider.authorize)
 *   POST /xpert-login       formani qabul qilish (bu fayl)
 *   POST /token             code → token (mcpAuthRouter)
 *   POST /revoke            token'ni bekor qilish (mcpAuthRouter)
 *   ALL  /mcp               MCP protokoli, Bearer token talab qiladi
 *   GET  /connection-status EzguTech CRM uchun: joriy foydalanuvchi ulaganmi?
 *   GET  /healthz           tiriklik tekshiruvi
 */

import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Request, type Response } from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { config } from './config.js'
import { whoAmI } from './xpert.js'
import { completeLogin, connectionFor, loginPage, provider, stats } from './oauth.js'
import { buildServer } from './server.js'

const log = (message: string): void => {
  process.stderr.write(`[xpert-mcp] ${message}\n`)
}

export const startHttp = async (): Promise<void> => {
  const app = express()

  app.disable('x-powered-by')

  // `trust proxy: true` XAVFLI: u X-Forwarded-For ga to'liq ishonadi va
  // hujumchi rate-limit'ni soxta IP bilan chetlab o'tishi mumkin
  // (express-rate-limit buni ERR_ERL_PERMISSIVE_TRUST_PROXY deb ogohlantiradi).
  // Shuning uchun aniq proxy sonini beramiz: cloudflared/nginx orqasida 1.
  app.set('trust proxy', config.trustProxyHops)

  // Brend fayllari (logotip, illyustratsiya, mask) — login sahifasi uchun.
  // Illyustratsiya 1.25 MB, shuning uchun HTML ichiga joylanmaydi; brauzer
  // uni bir marta yuklab keshlaydi.
  const brandDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'brand')

  app.use(
    '/brand',
    express.static(brandDir, {
      immutable: true,
      maxAge: '30d',
      fallthrough: false,
    }),
  )

  const issuer = new URL(config.publicUrl)

  // OAuth avtorizatsiya serveri: metadata, /register, /authorize, /token, /revoke
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: issuer,
      baseUrl: issuer,
      scopesSupported: ['xpert:read'],
      resourceName: 'EZGUTECH CRM',
    }),
  )

  // ── Login formasini qabul qilish ───────────────────────────────────────────
  app.post('/xpert-login', express.urlencoded({ extended: false }), async (req, res) => {
    const authId = typeof req.body?.auth_id === 'string' ? req.body.auth_id : ''
    const login = typeof req.body?.login === 'string' ? req.body.login.trim() : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''

    const html = (error: string): void => {
      res
        .status(400)
        .setHeader('content-type', 'text/html; charset=utf-8')
        .setHeader('cache-control', 'no-store')
        .send(loginPage(authId, error))
    }

    if (!authId) return html("Avtorizatsiya so'rovi aniqlanmadi. claude.ai da qaytadan ulang.")
    if (!login || !password) return html("Login va parolni to'ldiring.")

    const outcome = await completeLogin(authId, login, password)

    if (outcome.redirectTo) {
      res.setHeader('cache-control', 'no-store')

      return res.redirect(302, outcome.redirectTo)
    }

    return html(outcome.error ?? 'Kirish muvaffaqiyatsiz.')
  })

  // ── MCP endpoint ───────────────────────────────────────────────────────────
  //
  // Sessiya boshqaruvi: `initialize` so'rovi yangi transport yaratadi va
  // `mcp-session-id` sarlavhasini qaytaradi; keyingi so'rovlar shu ID bilan
  // o'sha transportga tushadi.
  const transports = new Map<string, StreamableHTTPServerTransport>()
  const servers = new Map<string, McpServer>()

  const auth = requireBearerAuth({
    verifier: provider,
    requiredScopes: ['xpert:read'],
    resourceMetadataUrl: `${config.publicUrl}/.well-known/oauth-protected-resource`,
  })

  const handleMcp = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers['mcp-session-id']
    const existing = typeof sessionId === 'string' ? transports.get(sessionId) : undefined

    if (existing) {
      await existing.handleRequest(req, res, req.body)

      return
    }

    if (sessionId) {
      res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: "Sessiya topilmadi yoki muddati o'tgan" },
        id: null,
      })

      return
    }

    if (!isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: "Sessiya yo'q: avval initialize yuborilishi kerak" },
        id: null,
      })

      return
    }

    // Yangi sessiya
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: id => {
        transports.set(id, transport)
        log(`MCP sessiyasi ochildi: ${id} (jami ${transports.size})`)
      },
      onsessionclosed: id => {
        transports.delete(id)
        void servers.get(id)?.close()
        servers.delete(id)
        log(`MCP sessiyasi yopildi: ${id} (jami ${transports.size})`)
      },
      // Tunnel/proxy orqasida Host sarlavhasi turlicha bo'ladi — tekshirishni
      // proxy va TLS qatlamiga qoldiramiz, autentifikatsiya esa Bearer token.
      enableDnsRebindingProtection: false,
    })

    transport.onclose = () => {
      const id = transport.sessionId
      if (!id) return

      transports.delete(id)
      void servers.get(id)?.close()
      servers.delete(id)
    }

    const server = buildServer()

    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)

    const id = transport.sessionId
    if (id) servers.set(id, server)
  }

  app.post('/mcp', auth, express.json({ limit: '4mb' }), handleMcp)
  app.get('/mcp', auth, handleMcp)
  app.delete('/mcp', auth, handleMcp)

  // ── Ulanish holati (EzguTech CRM uchun) ───────────────────────────────────────
  //
  // CRM'dagi "Integratsiyalar" sahifasi shu yerdan biladi: joriy foydalanuvchi
  // Claude'ni ulaganmi yoki yo'q. So'rovchi O'ZINING EzguTech tokenini yuboradi,
  // biz uni EzguTech'da tekshiramiz va faqat o'sha odamning holatini qaytaramiz —
  // ya'ni bu endpoint boshqa birovning ulanishini oshkor qilmaydi.
  const statusCors = (req: Request, res: Response): boolean => {
    const origin = req.headers.origin

    if (typeof origin !== 'string') return true // brauzerdan emas (curl, server) — CORS shart emas

    if (!config.statusOrigins.includes(origin.replace(/\/+$/, ''))) return false

    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'Origin')
    res.setHeader('access-control-allow-headers', 'authorization, content-type')
    res.setHeader('access-control-max-age', '86400')

    return true
  }

  app.options('/connection-status', (req, res) => {
    if (!statusCors(req, res)) {
      res.status(403).end()

      return
    }
    res.status(204).end()
  })

  app.get('/connection-status', async (req, res) => {
    if (!statusCors(req, res)) {
      res.status(403).json({ error: 'origin_not_allowed' })

      return
    }

    res.setHeader('cache-control', 'no-store')

    const header = req.headers.authorization
    const bearer = typeof header === 'string' && /^Bearer /i.test(header) ? header.slice(7) : ''

    if (!bearer) {
      res.status(401).json({ error: 'missing_token' })

      return
    }

    const user = await whoAmI(bearer)

    if (!user?.login) {
      res.status(401).json({ error: 'invalid_token' })

      return
    }

    res.json({ login: user.login, ...connectionFor(user.login) })
  })

  // ── Diagnostika ────────────────────────────────────────────────────────────
  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      transport: 'http',
      publicUrl: config.publicUrl,
      xpertApi: config.apiUrl,
      mcpSessions: transports.size,
      oauth: stats(),
    })
  })

  app.get('/', (_req, res) => {
    res
      .status(200)
      .setHeader('content-type', 'text/plain; charset=utf-8')
      .send(
        'EZGUTECH MCP server.\n\n' +
          `claude.ai da custom connector qo'shishda shu manzilni kiriting:\n` +
          `${config.publicUrl}/mcp\n`,
      )
  })

  await new Promise<void>(resolve => {
    app.listen(config.port, () => resolve())
  })

  log(`HTTP rejimida ishga tushdi · port ${config.port}`)
  log(`ochiq manzil: ${config.publicUrl}`)
  log(`claude.ai connector URL: ${config.publicUrl}/mcp`)
  log(`EzguTech API: ${config.apiUrl}`)
  log(
    `cheklovlar: oraliq ≤ ${config.maxRangeDays} kun, qator ≤ ${config.maxRows}, ` +
      `kesh ${config.cacheTtlMs / 1000}s, rate limit ${config.rateLimitMax}/${
        config.rateLimitWindowMs / 1000
      }s (har foydalanuvchi)`,
  )
}
