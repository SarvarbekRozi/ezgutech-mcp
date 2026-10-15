/**
 * Smoke-test: serverni ishga tushirib, MCP qo'l berishini, tool'lar ro'yxatini
 * va `shartnoma_kor` javobini tekshiradi. Haqiqiy EzguTech API'ga bormaydi —
 * soxta HTTP server oldindan tayyorlangan shartnomalarni qaytaradi.
 *
 *   node scripts/smoke.mjs
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FAKE_API_PORT = 8793

const client = { firstname: 'Alisher', lastname: 'Aliyev', phone: '901234567', address: 'Toshkent' }
const meta = {
  status: 1,
  confirmation_status: 2,
  credit_months: 12,
  credit_payment_day: 15,
  start_date: '2026-01-15',
  end_date: '2027-01-15',
  client,
  warehouse: { name: 'Yunusobod 13' },
  collector: { name: 'Undiruvchi Vali' },
  operator: { name: 'Operator Ali' },
  created_user: { name: 'Operator' },
}

const noDevices = {
  mobilelock_devices: [],
  seven_mdm_devices: [],
}

/**
 * EzguTech modellarida haqiqatan bor relation'lar. API noma'lum relation
 * so'ralsa 500 qaytaradi (RelationNotFoundException) — soxta API ham shunday
 * qiladi, shunda Abbot'dan qolgan relation (seller, knoxDevices, payment.client...)
 * qaytib kelsa smoke-test yiqiladi.
 */
const KNOWN_RELATIONS = {
  contract: [
    'client',
    'warehouse',
    'collector',
    'operator',
    'createdUser',
    'products',
    'products.category',
    'mobilelockDevices',
    'sevenMdmDevices',
  ],
  operation: [
    'account',
    'subAccount',
    'source',
    'contragent',
    'employee',
    'createdUser',
    'warehouse',
    'payment',
    'payment.contract',
    'payment.contract.client',
    'payment.debtClient',
  ],
  debtClient: ['warehouse', 'debts', 'payments', 'createdUser'],
}

const unknownRelations = (url, model) =>
  (url.searchParams.get('relations') ?? '')
    .split('|')
    .filter(Boolean)
    .filter(r => !KNOWN_RELATIONS[model].includes(r))

/**
 * `shartnoma_kor` uchun sinov shartnomalari. EzguTech javobining faqat shu tool
 * o'qiydigan maydonlari — qolgani javobga ta'sir qilmaydi.
 */
const CONTRACTS = {
  // 1 — oddiy so'mdagi shartnoma: bitta sotilgan tovar + bitta bonus,
  //     qurilma ikkala qulflash servisiga (Mobilock, 7MDM) ham ulangan.
  1: {
    ...meta,
    id: 1,
    is_rejected: 0,
    currency: 'uzs',
    credit_amount: 12_000_000,
    in_advance_payment_amount: 2_000_000,
    all_payment_amount: 4_000_000,
    products: [
      {
        id: 101,
        seria: '355612345678901',
        cost: 7_000_000,
        price_with_percent: 9_500_000,
        category: { name: 'Samsung A17' },
      },
      {
        id: 102,
        as_bonus: 1,
        cost: 200_000,
        price_with_percent: 0,
        category: { name: 'Quloqchin' },
      },
    ],
    mobilelock_devices: [
      { product_id: 101, status: -1, status_name: 'Bloklangan', auto_block: 1, imei: '355612345678901' },
    ],
    // 7MDM'da IMEI bo'lmasa seriya raqami `sn` ustunida keladi
    seven_mdm_devices: [
      { product_id: 101, status: 'active', status_name: 'Faol', auto_block: 0, imei: null, sn: 'SN7MDM0001' },
    ],
  },

  // 2 — bekor qilingan: tovar omborga qaytgani uchun `products` bo'sh keladi.
  //     Tannarx 0 deb ko'rsatilmasligi kerak.
  2: {
    ...meta,
    ...noDevices,
    id: 2,
    is_rejected: 1,
    rejected_at: '2026-03-01',
    rejection_reason: 'Mijoz voz kechdi',
    currency: 'uzs',
    credit_amount: 12_000_000,
    all_payment_amount: 0,
    products: [],
  },

  // 3 — dollardagi shartnoma: birinchi tovarda `cost_dollar` yo'q. Kurs MCP'da
  //     yo'q, shuning uchun u jamiga kirmasligi va bu aytilishi kerak.
  3: {
    ...meta,
    ...noDevices,
    id: 3,
    is_rejected: 0,
    currency: 'usd',
    credit_amount: 1000,
    all_payment_amount: 200,
    products: [
      {
        id: 301,
        seria: 'X1',
        cost: 7_000_000,
        cost_dollar: null,
        price_with_percent: 9_500_000,
        price_with_percent_dollar: 800,
        category: { name: 'iPhone 13' },
      },
      {
        id: 302,
        cost: 1_000_000,
        cost_dollar: 90,
        price_with_percent: 1_300_000,
        price_with_percent_dollar: 120,
        category: { name: 'iPad' },
      },
    ],
  },

  // 4 — tovari bor, lekin hech qanday qulflash servisiga ulanmagan.
  4: {
    ...meta,
    ...noDevices,
    id: 4,
    is_rejected: 0,
    currency: 'uzs',
    credit_amount: 700_000,
    all_payment_amount: 0,
    products: [{ id: 401, cost: 500_000, price_with_percent: 700_000, category: { name: 'Televizor' } }],
  },
}

/**
 * `moliyaviy_operatsiyalar` uchun: shartnoma to'lovi, qarzdor to'lovi va qo'lda
 * kiritilganlar. EzguTech'da `date` faqat sana (`date` cast + serializeDate →
 * "Y-m-d 00:00:00"), aniq vaqt `created_at` da.
 */
const OPERATIONS = [
  {
    id: 9001,
    date: '2026-09-16 00:00:00',
    created_at: '2026-09-16 14:37:02',
    amount: 5_000_000,
    currency: 'uzs',
    type: 'in',
    comment: "CLICK orqali 6131-shartnoma uchun oylik to'lov qabul qilindi",
    account: { name: 'CLICK (p2p)' },
    source: { name: 'Sotuvdan tushum' },
    contragent: null,
    employee: null,
    created_user: { name: 'Xushnud' },
    payment: {
      contract_id: 6131,
      contract: { id: 6131, client: { lastname: 'Valiyev', firstname: 'Ali', middlename: 'Valievich' } },
      debt_client: null,
    },
  },
  {
    id: 9004,
    date: '2026-09-16 00:00:00',
    created_at: '2026-09-16 11:20:45',
    amount: 300_000,
    currency: 'uzs',
    type: 'in',
    comment: "Qarzga savdo bo'yicha to'lov",
    account: { name: 'Asosiy kassa' },
    source: { name: "Qarz to'lovi" },
    created_user: { name: 'Xushnud' },
    payment: { contract_id: null, contract: null, debt_client: { name: 'Karimov Karim' } },
  },
  {
    id: 9002,
    date: '2026-09-15 00:00:00',
    created_at: '2026-09-16 09:05:00',
    amount: 100_000,
    currency: 'uzs',
    type: 'out',
    comment: 'Ofis uchun suv',
    account: { name: 'Asosiy kassa' },
    source: { name: "Xo'jalik xarajati" },
    contragent: { name: 'Suv yetkazuvchi' },
    created_user: { name: 'Operator' },
    payment: null,
  },
  {
    id: 9003,
    date: '2026-09-15 00:00:00',
    created_at: '2026-09-15 08:00:00',
    amount: 1,
    currency: 'uzs',
    type: 'out',
    // 300 belgidan uzun izoh kesilishi kerak — oxiridagi belgi javobga tushmasin
    comment: `${'u'.repeat(305)}KESILDI`,
    account: { name: 'Asosiy kassa' },
    source: { name: 'Boshqa' },
    created_user: { name: 'Operator' },
    payment: null,
  },
]

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// stdio rejimi ishga tushishda darhol EzguTech'ga login qiladi, shuning uchun
// soxta login endpoint'i kerak. Haqiqiy hisob va haqiqiy server ishlatilmaydi.
const fakeApi = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname

  // `totals=` so'rovi bazada sum() qiladi — soxta API ham alohida javob beradi.
  const totals = url.searchParams.get('totals')

  const model = path.endsWith('/finance/operations')
    ? 'operation'
    : path.endsWith('/debts/debt-clients')
      ? 'debtClient'
      : /\/contracts(\/\d+)?$/.test(path)
        ? 'contract'
        : null

  const unknown = model ? unknownRelations(url, model) : []
  if (unknown.length) {
    return json(res, 500, {
      success: false,
      message: `Call to undefined relationship [${unknown[0]}] on model`,
    })
  }

  if (path.endsWith('/finance/operations')) {
    return totals
      ? json(res, 200, { success: true, data: { total_amount: 5_400_001 } })
      : json(res, 200, { success: true, data: { data: OPERATIONS, total: OPERATIONS.length } })
  }

  // Saldo — model accessor'i: `appends=saldo` so'ralmasa javobga kirmaydi.
  if (path.endsWith('/debts/debt-clients')) {
    const withSaldo = (url.searchParams.get('appends') ?? '').split('|').includes('saldo')
    const rows = [
      { id: 1, name: 'Karimov Karim', phone: '901112233', saldo: 1_500_000, warehouse: { name: 'Yunusobod 13' } },
      { id: 2, name: 'Toshev Tosh', phone: '907778899', saldo: -20_000, warehouse: { name: 'Chilonzor' } },
    ].map(({ saldo, ...row }) => (withSaldo ? { ...row, saldo } : row))

    return json(res, 200, { success: true, data: { data: rows, total: rows.length } })
  }

  if (path.endsWith('/auth/login')) {
    return json(res, 200, {
      success: true,
      data: {
        access_token: 'FAKE-JWT',
        user: { name: 'Smoke Test', login: 'smoke-test', company: { name: 'Test' } },
      },
    })
  }

  const contract = CONTRACTS[path.match(/\/contracts\/(\d+)$/)?.[1]]
  if (contract) return json(res, 200, { success: true, data: contract })

  // Ro'yxat (`shartnoma_qidir`): filtrlar e'tiborga olinmaydi, doim ikkitasi.
  if (path.endsWith('/contracts')) {
    return json(res, 200, { success: true, data: { data: [CONTRACTS[1], CONTRACTS[3]], total: 2 } })
  }

  return json(res, 404, { success: false, message: `Soxta API bu yo'lni bilmaydi: ${path}` })
}).listen(FAKE_API_PORT)

const child = spawn(process.execPath, [join(root, 'dist', 'index.js')], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    XPERT_TRANSPORT: 'stdio',
    XPERT_API_URL: `http://127.0.0.1:${FAKE_API_PORT}/api/v1`,
    XPERT_LOGIN: 'smoke-test',
    XPERT_PASSWORD: 'smoke-test',
    XPERT_PUBLIC_URL: '',
  },
})

child.stderr.on('data', d => process.stderr.write(`  [server] ${d}`))

let buffer = ''
const pending = new Map()

child.stdout.on('data', chunk => {
  buffer += chunk.toString()

  let index
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue

    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      console.error('JSON emas:', line)
      continue
    }

    const resolve = pending.get(msg.id)
    if (resolve) {
      pending.delete(msg.id)
      resolve(msg)
    }
  }
})

let nextId = 1

const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, resolve)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} javob bermadi (10s)`))
    }, 10_000)
  })

const notify = method =>
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`)

const fail = message => {
  console.error(`\n✗ ${message}`)
  child.kill()
  process.exit(1)
}

try {
  const init = await call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '1.0.0' },
  })

  if (init.error) fail(`initialize xato: ${JSON.stringify(init.error)}`)
  console.log(`✓ initialize — server: ${init.result.serverInfo.name} v${init.result.serverInfo.version}`)

  if (!init.result.instructions?.includes('UZS')) {
    fail("instructions da valyuta qoidasi yo'q")
  }
  console.log('✓ instructions uzatildi (valyuta qoidasi bor)')

  notify('notifications/initialized')

  const list = await call('tools/list')
  if (list.error) fail(`tools/list xato: ${JSON.stringify(list.error)}`)

  const tools = list.result.tools
  console.log(`✓ tools/list — ${tools.length} ta tool:`)

  const expected = [
    'kassa_hisoboti',
    'moliyaviy_operatsiyalar',
    'qarzdor_mijozlar',
    'shartnoma_qidir',
    'shartnoma_kor',
    'omborlar',
    'hisoblar',
  ]

  // EzguTech'da `reports/material` endpoint'i yo'q — tool ro'yxatda bo'lmasligi kerak
  const unexpected = ['moddiy_hisobot']

  for (const tool of tools) {
    const params = Object.keys(tool.inputSchema?.properties ?? {})
    const ro = tool.annotations?.readOnlyHint === true ? 'read-only' : 'YOZISH!'
    console.log(`   · ${tool.name.padEnd(24)} [${ro}] (${params.join(', ') || 'parametrsiz'})`)
  }

  const missing = expected.filter(name => !tools.some(t => t.name === name))
  if (missing.length) fail(`ro'yxatda yo'q: ${missing.join(', ')}`)

  const extra = tools.filter(t => unexpected.includes(t.name))
  if (extra.length) fail(`ro'yxatda bo'lmasligi kerak: ${extra.map(t => t.name).join(', ')}`)

  const writable = tools.filter(t => t.annotations?.readOnlyHint !== true)
  if (writable.length) fail(`read-only emas: ${writable.map(t => t.name).join(', ')}`)
  console.log('✓ barcha tool readOnlyHint: true')

  // Validatsiya haqiqatan ishlashini tekshiramiz: 366 kundan uzun oraliq
  const tooLong = await call('tools/call', {
    name: 'kassa_hisoboti',
    arguments: { from_date: '2020-01-01', to_date: '2026-12-31' },
  })

  const text = tooLong.result?.content?.[0]?.text ?? ''
  if (tooLong.result?.isError !== true || !text.includes("oralig'i juda uzun")) {
    fail(`sana cheklovi ishlamadi. Javob: ${text.slice(0, 200)}`)
  }
  console.log("✓ sana oralig'i cheklovi ishlaydi (API'ga bormasdan to'xtatdi)")

  // Noto'g'ri sana
  const badDate = await call('tools/call', {
    name: 'kassa_hisoboti',
    arguments: { from_date: '2026-02-31' },
  })
  if (badDate.result?.isError !== true) fail('mavjud bo\'lmagan sana o\'tib ketdi')
  console.log('✓ mavjud bo\'lmagan sana rad etildi')

  // ── shartnoma_kor: tannarx/foyda va qulflash servislari ───────────────────
  const contractText = async id => {
    const res = await call('tools/call', { name: 'shartnoma_kor', arguments: { id } })

    if (res.error) fail(`shartnoma_kor #${id} xato: ${JSON.stringify(res.error)}`)

    const out = res.result?.content?.[0]?.text ?? ''
    if (res.result?.isError === true) fail(`shartnoma_kor #${id} xato javob: ${out.slice(0, 300)}`)

    return out
  }

  const expectAll = (label, out, needles) => {
    const absent = needles.filter(n => !out.includes(n))

    if (absent.length) {
      fail(`${label} — javobda yo'q: ${absent.join(' | ')}\n--- javob ---\n${out}`)
    }

    console.log(`✓ ${label}`)
  }

  const expectNone = (label, out, needles) => {
    const present = needles.filter(n => out.includes(n))

    if (present.length) {
      fail(`${label} — javobda bo'lmasligi kerak edi: ${present.join(' | ')}`)
    }

    console.log(`✓ ${label}`)
  }

  const toolText = async (name, args = {}) => {
    const res = await call('tools/call', { name, arguments: args })

    if (res.error) fail(`${name} xato: ${JSON.stringify(res.error)}`)

    const out = res.result?.content?.[0]?.text ?? ''
    if (res.result?.isError === true) fail(`${name} xato javob: ${out.slice(0, 300)}`)

    return out
  }

  expectAll('shartnoma_kor: tannarx, foyda va bonus tovar', await contractText(1), [
    'Mahsulotlar (tannarx va foyda)',
    'Samsung A17',
    '_(bonus)_',
    // 7 000 000 + 200 000 tannarx, 9 500 000 sotuv, 2 300 000 foyda
    "**Jami tannarx:** 7,200,000 so'm",
    "**Jami sotuv:** 9,500,000 so'm",
    "**Foyda:** 2,300,000 so'm (marja 24.2%)",
  ])

  expectAll('shartnoma_kor: ikkala qulflash servisi', await contractText(1), [
    'Qulflovchi servislar',
    'Mobilock',
    '7MDM',
    'Bloklangan',
    '355612345678901',
    // 7MDM'da IMEI yo'q — seriya raqami (`sn`) ko'rsatiladi
    'SN7MDM0001',
    // 7MDM'da auto_block = 0
    "Yo'q",
  ])

  expectNone("shartnoma_kor: EzguTech'da yo'q servislar ko'rsatilmaydi", await contractText(1), [
    'SCON',
    'Knox',
    'Sotuvchi',
  ])

  expectAll('shartnoma_kor: undiruvchi va operator', await contractText(1), [
    '**Undiruvchi:** Undiruvchi Vali',
    '**Operator:** Operator Ali',
  ])

  expectAll('shartnoma_kor: bekor qilinganda tannarx hisoblanmaydi', await contractText(2), [
    'BEKOR QILINGAN',
    'tannarx va foyda hisoblanmaydi',
    'hech qanday qulflash servisiga ulanmagan',
  ])

  expectAll('shartnoma_kor: USD shartnomada tushmagan narx aytiladi', await contractText(3), [
    // faqat ikkinchi tovarning dollardagi tannarxi bor
    '**Jami tannarx:** 90 $',
    '**Jami sotuv:** 920 $',
    '**Foyda:** 830 $',
    '1 ta tovarda shartnoma valyutasidagi (USD) narx',
  ])

  expectAll('shartnoma_kor: qulfsiz shartnoma', await contractText(4), [
    "**Jami tannarx:** 500,000 so'm",
    'hech qanday qulflash servisiga ulanmagan',
  ])

  // ── shartnoma_qidir: pul ustunlari va valyuta bo'yicha jami ────────────────
  const listRes = await call('tools/call', { name: 'shartnoma_qidir', arguments: {} })
  if (listRes.error) fail(`shartnoma_qidir xato: ${JSON.stringify(listRes.error)}`)

  const listText = listRes.result?.content?.[0]?.text ?? ''
  if (listRes.result?.isError === true) fail(`shartnoma_qidir xato javob: ${listText.slice(0, 300)}`)

  expectAll("shartnoma_qidir: so'mdagi shartnoma ustunlari", listText, [
    "| Tannarx | Oldindan | Kredit | Jami sotuv | To'langan | Qolgan | Foyda |",
    // #1: tannarx 7,2 mln; kredit 12 mln + oldindan 2 mln = 14 mln sotuv;
    //     to'langan 4 mln → qolgan 8 mln; foyda 14 − 7,2 = 6,8 mln
    "| 7,200,000 so'm | 2,000,000 so'm | 12,000,000 so'm | 14,000,000 so'm | " +
      "4,000,000 so'm | 8,000,000 so'm | 6,800,000 so'm |",
  ])

  expectAll("shartnoma_qidir: USD shartnomada tannarx noma'lum", listText, [
    // #3: cost_dollar yo'q → tannarx va foyda "—", qolganlari hisoblanadi
    '| — | 0 $ | 1,000 $ | 1,000 $ | 200 $ | 800 $ | — |',
    '1 ta shartnomada tannarx aniqlanmadi',
  ])

  expectAll("shartnoma_qidir: jami valyuta bo'yicha alohida", listText, [
    "**UZS** — tannarx: 7,200,000 so'm, oldindan: 2,000,000 so'm, kredit: 12,000,000 so'm, " +
      "jami sotuv: 14,000,000 so'm, to'langan: 4,000,000 so'm, qolgan: 8,000,000 so'm, " +
      "foyda: 6,800,000 so'm",
    // USD'da birorta ham ma'lum tannarx yo'q → jami "0 $" emas, "—"
    "**USD** — tannarx: —, oldindan: 0 $, kredit: 1,000 $, jami sotuv: 1,000 $, " +
      "to'langan: 200 $, qolgan: 800 $, foyda: —",
  ])

  // ── moliyaviy_operatsiyalar: yangi ustunlar ───────────────────────────────
  const opsText = await toolText('moliyaviy_operatsiyalar')

  expectAll('moliyaviy_operatsiyalar: ustunlar va shartnoma to\'lovi', opsText, [
    "| ID | Sana | Kiritilgan vaqt | Summa | Turi | Hisob | Manba | Mijoz | Shartnoma № | " +
      'Kontragent / xodim | Kiritgan | Izoh |',
    "| 9001 | 16.09.2026 | 16.09.2026 14:37 | 5,000,000 so'm | Kirim | CLICK (p2p) | Sotuvdan tushum | " +
      "Valiyev Ali Valievich | 6131 | — | Xushnud | CLICK orqali 6131-shartnoma uchun " +
      "oylik to'lov qabul qilindi |",
  ])

  expectAll("moliyaviy_operatsiyalar: qarzdor to'lovida mijoz qarzdordan olinadi", opsText, [
    "| 9004 | 16.09.2026 | 16.09.2026 11:20 | 300,000 so'm | Kirim | Asosiy kassa | Qarz to'lovi | " +
      "Karimov Karim | — | — | Xushnud | Qarzga savdo bo'yicha to'lov |",
  ])

  expectAll("moliyaviy_operatsiyalar: qo'lda kiritilganda mijoz bo'sh", opsText, [
    "| 9002 | 15.09.2026 | 16.09.2026 09:05 | 100,000 so'm | Chiqim | Asosiy kassa | Xo'jalik xarajati | " +
      '— | — | Suv yetkazuvchi | Operator | Ofis uchun suv |',
  ])

  // `date` faqat sana — "00:00" soxta vaqt sifatida ko'rinmasligi kerak
  expectNone('moliyaviy_operatsiyalar: sanaga soxta 00:00 qo\'shilmaydi', opsText, ['00:00'])

  expectNone('moliyaviy_operatsiyalar: uzun izoh 300 belgida kesiladi', opsText, ['KESILDI'])

  // ── qarzdor_mijozlar: saldo `appends` bilan so'raladi ─────────────────────
  const debtText = await toolText('qarzdor_mijozlar')

  expectAll('qarzdor_mijozlar: saldo javobda bor', debtText, [
    "| Karimov Karim | +998901112233 | 1,500,000 so'm | Yunusobod 13 |",
    "| Toshev Tosh | +998907778899 | -20,000 so'm | Chilonzor |",
  ])

  console.log('\n✓ HAMMASI O\'TDI')
  child.kill()
  fakeApi.close()
  process.exit(0)
} catch (err) {
  fail(err.message)
}
