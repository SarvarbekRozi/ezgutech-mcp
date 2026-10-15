/**
 * HTTP rejimi uchun uchdan-uchga smoke-test.
 *
 * claude.ai nima qilsa, shuni qiladi:
 *   metadata → /register → /authorize → login formasi → /token → /mcp
 *
 * EzguTech API'ni o'rniga soxta server qo'yiladi, shuning uchun haqiqiy hisob
 * kerak emas va hech kimning ma'lumotiga tegilmaydi.
 *
 *   node scripts/smoke-http.mjs
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const MCP_PORT = 8791
const FAKE_API_PORT = 8792
const PUBLIC_URL = `http://127.0.0.1:${MCP_PORT}`
const CRM_ORIGIN = 'https://crm.ezgutech.uz'

let failed = false
const ok = m => console.log(`✓ ${m}`)
const bad = m => {
  console.error(`✗ ${m}`)
  failed = true
}

// ── Soxta EzguTech API ───────────────────────────────────────────────────────────
const calls = []

const fakeApi = createServer((req, res) => {
  const url = new URL(req.url, `http://x`)
  const auth = req.headers.authorization ?? ''

  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw || '{}')
      calls.push({ path: url.pathname, login: body.login })

      if (body.login === 'testuser' && body.password === 'testpass') {
        return json(200, {
          success: true,
          data: {
            access_token: 'FAKE-JWT-testuser',
            token_type: 'bearer',
            user: { id: 1, name: 'Test Xodim', login: 'testuser', company: { name: 'Test MChJ' } },
          },
        })
      }

      return json(401, { success: false, message: 'Login yoki parol xato' })
    })

    return
  }

  calls.push({ path: url.pathname, auth, query: Object.fromEntries(url.searchParams) })

  // Har so'rov to'g'ri foydalanuvchining tokeni bilan kelishi kerak
  if (auth !== 'Bearer FAKE-JWT-testuser') {
    return json(401, { success: false, message: 'Unauthenticated' })
  }

  // `GET /connection-status` token egasini shu yerdan aniqlaydi
  if (url.pathname === '/api/v1/auth/me') {
    return json(200, { success: true, data: { id: 1, name: 'Test Xodim', login: 'testuser' } })
  }

  if (url.pathname === '/api/v1/warehouses/warehouses') {
    return json(200, {
      success: true,
      data: {
        total: 2,
        data: [
          { id: 3, name: 'Asosiy Ombor', address: 'Toshkent' },
          { id: 7, name: 'yunusobod 13', address: 'Yunusobod' },
        ],
      },
    })
  }

  if (url.pathname === '/api/v1/finance/account-operations') {
    return json(200, {
      success: true,
      data: [
        {
          account_id: 1,
          account_name: 'Naqd UZS',
          currency: 'uzs',
          income_count: 2,
          income_sum: 4020551,
          expense_count: 1,
          expense_sum: -9031081,
          total_sum: -5010530,
        },
        {
          account_id: 2,
          account_name: 'Naqd USD',
          currency: 'usd',
          income_count: 4,
          income_sum: 215,
          expense_count: 0,
          expense_sum: 0,
          total_sum: 215,
        },
      ],
    })
  }

  return json(404, { success: false, message: `Soxta API: ${url.pathname} yo'q` })
}).listen(FAKE_API_PORT)

// ── MCP serverni ishga tushirish ──────────────────────────────────────────────
const child = spawn(process.execPath, [join(root, 'dist', 'index.js')], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'pipe'],
  env: {
    ...process.env,
    XPERT_TRANSPORT: 'http',
    XPERT_API_URL: `http://127.0.0.1:${FAKE_API_PORT}/api/v1`,
    XPERT_PUBLIC_URL: PUBLIC_URL,
    PORT: String(MCP_PORT),
    XPERT_LOGIN: '',
    XPERT_PASSWORD: '',
    XPERT_CACHE_TTL_MS: '1',
    XPERT_STATUS_ORIGINS: CRM_ORIGIN,
  },
})

child.stderr.on('data', d => process.stderr.write(`  [server] ${d}`))

const cleanup = () => {
  child.kill()
  fakeApi.close()
}

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${PUBLIC_URL}/healthz`)
      if (r.ok) return
    } catch {
      /* hali ko'tarilmagan */
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error("server 15 soniyada ko'tarilmadi")
}

try {
  await waitForServer()
  ok('server ko\'tarildi')

  // ── 1. Protected resource metadata ─────────────────────────────────────────
  const prm = await (await fetch(`${PUBLIC_URL}/.well-known/oauth-protected-resource`)).json()
  if (!prm.authorization_servers?.length) bad('oauth-protected-resource da authorization_servers yo\'q')
  else ok(`protected-resource metadata (AS: ${prm.authorization_servers[0]})`)

  // ── 2. Authorization server metadata ───────────────────────────────────────
  const asm = await (await fetch(`${PUBLIC_URL}/.well-known/oauth-authorization-server`)).json()
  for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    if (!asm[field]) bad(`AS metadata da ${field} yo'q`)
  }
  if (!asm.code_challenge_methods_supported?.includes('S256')) bad('PKCE S256 qo\'llanmaydi')
  else ok('AS metadata + PKCE S256')

  // ── 3. /mcp himoyalanganini tekshirish ─────────────────────────────────────
  const noAuth = await fetch(`${PUBLIC_URL}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  })
  if (noAuth.status !== 401) bad(`/mcp tokensiz ${noAuth.status} qaytardi, 401 bo'lishi kerak`)
  else if (!(noAuth.headers.get('www-authenticate') ?? '').includes('resource_metadata'))
    bad('401 da WWW-Authenticate resource_metadata yo\'q')
  else ok('/mcp tokensiz 401 + WWW-Authenticate beradi')

  // ── 4. Dinamik ro'yxat ─────────────────────────────────────────────────────
  const reg = await (
    await fetch(asm.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Smoke Test',
        redirect_uris: ['http://127.0.0.1:9999/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    })
  ).json()
  if (!reg.client_id) bad(`/register client_id qaytarmadi: ${JSON.stringify(reg)}`)
  else ok(`dinamik ro'yxat — client_id olindi`)

  // ── 5. /authorize → login formasi ──────────────────────────────────────────
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  const authUrl = new URL(asm.authorization_endpoint)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', reg.client_id)
  authUrl.searchParams.set('redirect_uri', 'http://127.0.0.1:9999/callback')
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', 'xyz')
  authUrl.searchParams.set('resource', `${PUBLIC_URL}/mcp`)

  const form = await (await fetch(authUrl)).text()
  const authId = form.match(/name="auth_id" value="([^"]+)"/)?.[1]
  if (!authId) bad('login formasi auth_id bermadi')
  else ok('/authorize login formasini ko\'rsatdi')

  // ── 6. Noto'g'ri parol rad etilishi ────────────────────────────────────────
  const wrong = await fetch(`${PUBLIC_URL}/xpert-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ auth_id: authId, login: 'testuser', password: 'notmypassword' }),
    redirect: 'manual',
  })
  const wrongBody = await wrong.text()
  if (wrong.status === 302) bad('noto\'g\'ri parol bilan ham redirect qildi!')
  else if (!wrongBody.includes('Login yoki parol xato'))
    bad('noto\'g\'ri parolda EzguTech xatosi ko\'rsatilmadi')
  else ok('noto\'g\'ri parol rad etildi (EzguTech xatosi ko\'rsatildi)')

  // ── 7. To'g'ri parol → code ────────────────────────────────────────────────
  const good = await fetch(`${PUBLIC_URL}/xpert-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ auth_id: authId, login: 'testuser', password: 'testpass' }),
    redirect: 'manual',
  })
  if (good.status !== 302) bad(`to'g'ri parolda ${good.status} qaytdi, 302 kutilgan`)
  const location = good.headers.get('location') ?? ''
  const code = new URL(location, PUBLIC_URL).searchParams.get('code')
  const state = new URL(location, PUBLIC_URL).searchParams.get('state')
  if (!code) bad(`redirect da code yo'q: ${location}`)
  else if (state !== 'xyz') bad(`state saqlanmadi: ${state}`)
  else ok('to\'g\'ri parol → code + state qaytarildi')

  // ── 8. /token: code → access token ─────────────────────────────────────────
  const tokenRes = await fetch(asm.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: reg.client_id,
      redirect_uri: 'http://127.0.0.1:9999/callback',
      resource: `${PUBLIC_URL}/mcp`,
    }),
  })
  const tokens = await tokenRes.json()
  if (!tokens.access_token) bad(`/token access_token bermadi: ${JSON.stringify(tokens)}`)
  else if (!tokens.refresh_token) bad('/token refresh_token bermadi')
  else ok(`/token — access + refresh token olindi (${tokens.expires_in}s)`)

  // ── 9. PKCE haqiqatan tekshirilishini sinash ───────────────────────────────
  const replay = await fetch(asm.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: reg.client_id,
      redirect_uri: 'http://127.0.0.1:9999/callback',
    }),
  })
  if (replay.ok) bad('bir marta ishlatilgan code qayta qabul qilindi!')
  else ok('ishlatilgan code qayta qabul qilinmadi')

  // ── 10. MCP: initialize ────────────────────────────────────────────────────
  const mcpHeaders = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${tokens.access_token}`,
  }

  const parseMcp = async res => {
    const body = await res.text()
    const line = body.split('\n').find(l => l.startsWith('data:'))

    return JSON.parse(line ? line.slice(5).trim() : body)
  }

  const initRes = await fetch(`${PUBLIC_URL}/mcp`, {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'smoke-http', version: '1.0.0' },
      },
    }),
  })

  const sessionId = initRes.headers.get('mcp-session-id')
  const init = await parseMcp(initRes)
  if (init.error) bad(`initialize xato: ${JSON.stringify(init.error)}`)
  else if (!sessionId) bad('mcp-session-id sarlavhasi qaytmadi')
  else ok(`MCP initialize — sessiya ${sessionId.slice(0, 8)}…`)

  const withSession = { ...mcpHeaders, 'mcp-session-id': sessionId }

  await fetch(`${PUBLIC_URL}/mcp`, {
    method: 'POST',
    headers: withSession,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
  })

  // ── 11. tools/list ─────────────────────────────────────────────────────────
  const listRes = await fetch(`${PUBLIC_URL}/mcp`, {
    method: 'POST',
    headers: withSession,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  })
  const list = await parseMcp(listRes)
  const tools = list.result?.tools ?? []
  if (tools.length !== 7) bad(`7 ta tool kutilgan, ${tools.length} ta keldi`)
  else ok(`tools/list — ${tools.length} ta tool`)

  // ── 12. Haqiqiy tool chaqiruvi (soxta API'ga boradi) ───────────────────────
  const callRes = await fetch(`${PUBLIC_URL}/mcp`, {
    method: 'POST',
    headers: withSession,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'omborlar', arguments: {} },
    }),
  })
  const call = await parseMcp(callRes)
  const callText = call.result?.content?.[0]?.text ?? ''
  if (!callText.includes('yunusobod 13')) bad(`omborlar javobi kutilganday emas: ${callText.slice(0, 200)}`)
  else ok('tools/call omborlar — foydalanuvchi tokeni bilan API\'ga bordi')

  // ── 13. Valyutalar qo'shilmasligini tekshirish ─────────────────────────────
  const kassaRes = await fetch(`${PUBLIC_URL}/mcp`, {
    method: 'POST',
    headers: withSession,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'kassa_hisoboti', arguments: { from_date: '2026-08-01', to_date: '2026-08-10' } },
    }),
  })
  const kassa = await parseMcp(kassaRes)
  const kassaText = kassa.result?.content?.[0]?.text ?? ''

  const hasUzs = /\*\*UZS\*\*/.test(kassaText)
  const hasUsd = /\*\*USD\*\*/.test(kassaText)
  // 4 020 551 + 215 = 4 020 766 — agar shu son chiqsa, valyutalar qo'shilgan
  const mixed = kassaText.includes('4,020,766')

  if (!hasUzs || !hasUsd) bad(`jamilar valyuta bo'yicha ajratilmagan:\n${kassaText.slice(0, 400)}`)
  else if (mixed) bad('so\'m va dollar qo\'shilib ketgan!')
  else ok('jamilar UZS va USD bo\'yicha alohida (aralashmagan)')

  // ── 14. Sana cheklovi ──────────────────────────────────────────────────────
  const longRes = await fetch(`${PUBLIC_URL}/mcp`, {
    method: 'POST',
    headers: withSession,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'kassa_hisoboti', arguments: { from_date: '2020-01-01', to_date: '2026-12-31' } },
    }),
  })
  const long = await parseMcp(longRes)
  if (long.result?.isError !== true || !(long.result?.content?.[0]?.text ?? '').includes('juda uzun'))
    bad('sana cheklovi ishlamadi')
  else ok('sana oralig\'i cheklovi ishlaydi')

  // ── 15. Refresh token ──────────────────────────────────────────────────────
  const refreshRes = await fetch(asm.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: reg.client_id,
    }),
  })
  const refreshed = await refreshRes.json()
  if (!refreshed.access_token) bad(`refresh ishlamadi: ${JSON.stringify(refreshed)}`)
  else if (refreshed.access_token === tokens.access_token) bad('refresh eski tokenni qaytardi')
  else ok('refresh_token → yangi access token (EzguTech\'ga qayta login qildi)')

  // ── 16. Boshqa foydalanuvchi tokeni bilan kirib bo'lmasligini tekshirish ───
  const fakeToken = await fetch(`${PUBLIC_URL}/mcp`, {
    method: 'POST',
    headers: { ...mcpHeaders, authorization: 'Bearer soxta-token-12345' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/list', params: {} }),
  })
  if (fakeToken.status !== 401) bad(`soxta token ${fakeToken.status} qaytardi, 401 kutilgan`)
  else ok('soxta Bearer token rad etildi')

  // ── 17. CRM "Integratsiyalar" sahifasi uchun ulanish holati ────────────────
  // CRM foydalanuvchining O'Z EzguTech JWT'sini yuboradi (OAuth token emas).
  const status = await fetch(`${PUBLIC_URL}/connection-status`, {
    headers: { origin: CRM_ORIGIN, authorization: 'Bearer FAKE-JWT-testuser' },
  })
  const statusBody = await status.json().catch(() => ({}))
  if (status.status !== 200 || statusBody.connected !== true || statusBody.login !== 'testuser')
    bad(`connection-status: ${status.status} ${JSON.stringify(statusBody)}`)
  else if (status.headers.get('access-control-allow-origin') !== CRM_ORIGIN)
    bad('connection-status CRM origin uchun CORS sarlavhasini qo\'ymadi')
  else ok('connection-status: CRM foydalanuvchisi "ulangan" deb ko\'rindi')

  const foreign = await fetch(`${PUBLIC_URL}/connection-status`, {
    headers: { origin: 'https://evil.example', authorization: 'Bearer FAKE-JWT-testuser' },
  })
  if (foreign.status !== 403) bad(`begona origin ${foreign.status} oldi, 403 kutilgan`)
  else ok('connection-status: begona origin rad etildi')

  // ── Soxta API'ga borgan so'rovlar to'g'ri token bilan ketganini tekshirish ──
  const wrongTokenCalls = calls.filter(c => c.auth && c.auth !== 'Bearer FAKE-JWT-testuser')
  if (wrongTokenCalls.length) bad(`API'ga noto'g'ri token bilan ${wrongTokenCalls.length} so'rov ketdi`)
  else ok(`EzguTech API'ga ${calls.length} so'rov, hammasi to'g'ri foydalanuvchi tokeni bilan`)

  console.log(failed ? '\n✗ XATOLAR BOR' : '\n✓ HAMMASI O\'TDI')
  cleanup()
  process.exit(failed ? 1 : 0)
} catch (err) {
  console.error(`\n✗ ${err.stack ?? err.message}`)
  cleanup()
  process.exit(1)
}
