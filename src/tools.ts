/**
 * Tool'lar — Claude EzguTech bilan gaplashadigan yagona interfeys.
 *
 * Tamoyillar:
 *   - FAQAT O'QISH. Hech bir tool ma'lumotni o'zgartirmaydi.
 *   - `description` — modelning yagona ko'rsatmasi. Qachon chaqirilishini
 *     aniq yozish kerak, aks holda model noto'g'ri tool'ni tanlaydi.
 *   - Javob jamlangan bo'ladi: xom qatorlar emas, valyuta bo'yicha ajratilgan
 *     jamilar + kesilgan ro'yxat (nechtasi kesilgani aytiladi).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as xpert from './xpert.js'
import { config } from './config.js'
import { safe } from './errors.js'
import { sessionFrom } from './session.js'
import { formatDate, formatDateTime, resolveRange, today } from './dates.js'
import { Column, CurrencyTotals, limitRows, money, plain, table, text, toNumber } from './format.js'

// ── Umumiy sxema bo'laklari ───────────────────────────────────────────────────
const fromDate = z
  .string()
  .optional()
  .describe(`Boshlanish sanasi, YYYY-MM-DD. Berilmasa bugun (${today()}).`)

const toDate = z
  .string()
  .optional()
  .describe("Tugash sanasi, YYYY-MM-DD. Berilmasa from_date bilan bir xil (bitta kun).")

const warehouseId = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    "Filial/ombor ID. Nomini bilsangiz avval `omborlar` tool'i bilan ID'sini toping. " +
      'Berilmasa — ruxsat doirasidagi hammasi.',
  )

const RANGE_NOTE = `Sana oralig'i eng ko'pi ${config.maxRangeDays} kun bo'lishi mumkin.`

// ── Turlar (API javobining faqat kerakli qismi) ───────────────────────────────
interface AccountRow {
  account_id?: number
  account_name?: string
  currency?: string
  income_count?: number
  income_sum?: number | string
  expense_count?: number
  expense_sum?: number | string
  total_sum?: number | string
  sub_accounts?: Array<{
    sub_account_name?: string
    income_sum?: number | string
    expense_sum?: number | string
    total_sum?: number | string
  }>
}

interface Paginated<T> {
  data?: T[]
  total?: number
}

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

// ── Ro'yxatga olish ──────────────────────────────────────────────────────────
export const registerTools = (server: McpServer): void => {
  // ═══ 1. Kassa hisoboti ═════════════════════════════════════════════════════
  server.registerTool(
    'kassa_hisoboti',
    {
      title: 'Kassa hisoboti (hisoblar kesimi)',
      description:
        'Har bir kassa/bank hisobi bo\'yicha kirim, chiqim va balansni qaytaradi. ' +
        'Quyidagi kabi savollarda chaqiriladi: "bugun kassaga qancha tushdi", ' +
        '"shu oy qancha chiqim bo\'ldi", "qaysi hisobda qancha pul bor", ' +
        '"filiallar bo\'yicha tushum". ' +
        "So'm va dollar hisoblari ALOHIDA jamlanadi — ularni qo'shmang. " +
        RANGE_NOTE,
      inputSchema: { from_date: fromDate, to_date: toDate, warehouse_id: warehouseId },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    safe(async ({ from_date, to_date, warehouse_id }, extra) => {
      const session = sessionFrom(extra)
      const range = resolveRange(from_date, to_date)

      const rows = asArray<AccountRow>(
        await xpert.get(session, '/finance/account-operations', {
          from_date: range.from_date,
          to_date: range.to_date,
          warehouse_id,
        }),
      )

      if (!rows.length) {
        return text(`**Kassa** · ${formatDate(range.from_date)} — ${formatDate(range.to_date)}`, "Ma'lumot topilmadi.")
      }

      const totals = new CurrencyTotals(['income', 'expense', 'balance'] as const)
      for (const row of rows) {
        totals.add(row.currency, {
          income: row.income_sum,
          expense: row.expense_sum,
          balance: row.total_sum,
        })
      }

      const columns: Column<AccountRow>[] = [
        { header: 'Hisob', value: r => r.account_name ?? '—' },
        { header: 'Val.', value: r => (r.currency ?? 'uzs').toUpperCase() },
        { header: 'Kirim soni', align: 'right', value: r => plain(r.income_count) },
        { header: 'Kirim', align: 'right', value: r => money(r.income_sum, r.currency) },
        { header: 'Chiqim soni', align: 'right', value: r => plain(r.expense_count) },
        { header: 'Chiqim', align: 'right', value: r => money(r.expense_sum, r.currency) },
        { header: 'Balans', align: 'right', value: r => money(r.total_sum, r.currency) },
      ]

      const summary = totals
        .rows()
        .map(
          t =>
            `- **${t.currency.toUpperCase()}** — kirim: ${money(t.values.income, t.currency)}, ` +
            `chiqim: ${money(t.values.expense, t.currency)}, ` +
            `balans: ${money(t.values.balance, t.currency)}`,
        )
        .join('\n')

      const subAccounts = rows
        .filter(r => r.sub_accounts?.length)
        .map(r => {
          const list = (r.sub_accounts ?? [])
            .map(
              s =>
                `  - ${s.sub_account_name ?? '—'}: balans ${money(s.total_sum, r.currency)} ` +
                `(kirim ${money(s.income_sum, r.currency)}, chiqim ${money(s.expense_sum, r.currency)})`,
            )
            .join('\n')

          return `- **${r.account_name ?? '—'}** ichki hisoblari:\n${list}`
        })
        .join('\n')

      return text(
        `**Kassa hisoboti** · ${formatDate(range.from_date)} — ${formatDate(range.to_date)}` +
          (warehouse_id ? ` · ombor #${warehouse_id}` : ''),
        table(rows, columns),
        `**Jami (valyuta bo'yicha alohida):**\n${summary}`,
        subAccounts ? `**Ichki hisoblar:**\n${subAccounts}` : null,
      )
    }),
  )

  // ═══ 2. Moliyaviy operatsiyalar ════════════════════════════════════════════
  server.registerTool(
    'moliyaviy_operatsiyalar',
    {
      title: 'Moliyaviy operatsiyalar',
      description:
        "Kassa operatsiyalarining ro'yxati va jami summasi. Har bir operatsiya uchun " +
        "ID, sana, tizimga kiritilgan vaqti (soat:daqiqa), hisob, manba, mijoz, shartnoma " +
        "raqami, kim kiritgani va to'liq izoh qaytariladi. Kassa hisobotidagi bir raqamning ichini " +
        'ko\'rish uchun: "o\'sha 4 mln nimalardan yig\'ilgan", "kim qancha to\'lagan", ' +
        '"shu hisobga qanday chiqimlar bo\'lgan", "CLICK hisobiga bugun nima tushdi". ' +
        "Hisob nomini `hisoblar` tool'i bilan `account_id` ga aylantiring — ro'yxat " +
        'shunda ixcham va aniq bo\'ladi. ' +
        'Jami summa alohida agregat so\'rov bilan olinadi, ya\'ni faqat ' +
        "ko'rsatilgan qatorlar emas, butun filtr natijasiga tegishli. " +
        "DIQQAT: bu tool faqat kassa kirim/chiqimini ko'rsatadi — hisobdan hisobga " +
        "ko'chirilgan pul (p2p o'tkazma) EzguTech'da alohida jadvalda va bu ro'yxatga " +
        'tushmaydi. ' +
        RANGE_NOTE,
      inputSchema: {
        from_date: fromDate,
        to_date: toDate,
        warehouse_id: warehouseId,
        type: z
          .enum(['in', 'out'])
          .optional()
          .describe("'in' — kirimlar, 'out' — chiqimlar. Berilmasa ikkalasi."),
        account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Hisob ID. `hisoblar` tool'i bilan toping."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    safe(async ({ from_date, to_date, warehouse_id, type, account_id }, extra) => {
      const session = sessionFrom(extra)
      const range = resolveRange(from_date, to_date)

      const baseQuery = {
        from_date: range.from_date,
        to_date: range.to_date,
        warehouse_id,
        type,
        account_id,
      }

      interface Person {
        firstname?: string
        lastname?: string
        middlename?: string
      }

      interface Operation {
        id?: number
        /** Faqat sana: EzguTech'da `finance_operations.date` ustuni `date` turida */
        date?: string
        /** Operatsiya tizimga kiritilgan aniq vaqt (`Y-m-d H:i:s`) */
        created_at?: string
        amount?: number | string
        currency?: string
        type?: string
        comment?: string
        source?: { name?: string }
        account?: { name?: string }
        contragent?: { name?: string }
        employee?: { name?: string }
        created_user?: { name?: string }
        /**
         * To'lov hujjati — faqat savdo/shartnoma/qarz to'lovidan avtomatik
         * yaratilgan operatsiyada bo'ladi. Qo'lda kiritilgan kirim/chiqimda
         * `null` keladi, ya'ni mijoz va shartnoma raqami ham bo'lmaydi.
         *
         * EzguTech to'lovlarida `client_id` ustuni yo'q: mijoz shartnoma orqali
         * (`contract.client`), qarzga savdoda esa qarzdor (`debt_client`) orqali olinadi.
         */
        payment?: {
          contract_id?: number | null
          contract?: { id?: number; client?: Person | null } | null
          debt_client?: { name?: string } | null
        } | null
      }

      const [list, totals] = await Promise.all([
        xpert.get<Paginated<Operation>>(session, '/finance/operations', {
          ...baseQuery,
          per_page: config.maxRows,
          page: 1,
          relations:
            'account|source|contragent|employee|createdUser|' +
            'payment.contract.client|payment.debtClient',
          sort_key: 'date',
          sort_type: 'desc',
        }),
        // `totals=amount` → sum(amount). Arifmetika bazada bajariladi.
        xpert.get<{ total_amount?: number | string }>(session, '/finance/operations', {
          ...baseQuery,
          totals: 'amount',
        }),
      ])

      const rows = asArray<Operation>(list.data)
      const { shown, note } = limitRows(rows, list.total)

      if (!shown.length) {
        return text(
          `**Operatsiyalar** · ${formatDate(range.from_date)} — ${formatDate(range.to_date)}`,
          'Bu filtr bo\'yicha operatsiya topilmadi.',
        )
      }

      const perCurrency = new CurrencyTotals(['amount'] as const)
      for (const op of shown) perCurrency.add(op.currency, { amount: op.amount })

      const fullName = (p?: Person | null): string =>
        [p?.lastname, p?.firstname, p?.middlename].filter(Boolean).join(' ')

      const columns: Column<Operation>[] = [
        { header: 'ID', align: 'right', value: o => String(o.id ?? '—') },
        { header: 'Sana', value: o => formatDate(o.date) },
        { header: 'Kiritilgan vaqt', value: o => formatDateTime(o.created_at) },
        { header: 'Summa', align: 'right', value: o => money(o.amount, o.currency) },
        { header: 'Turi', value: o => (o.type === 'in' ? 'Kirim' : 'Chiqim') },
        { header: 'Hisob', value: o => o.account?.name ?? '—' },
        { header: 'Manba', value: o => o.source?.name ?? '—' },
        {
          header: 'Mijoz',
          value: o =>
            (fullName(o.payment?.contract?.client) || o.payment?.debt_client?.name || '—').replace(
              /\|/g,
              '/',
            ),
        },
        {
          header: 'Shartnoma №',
          align: 'right',
          value: o => String(o.payment?.contract_id ?? o.payment?.contract?.id ?? '—'),
        },
        {
          header: 'Kontragent / xodim',
          value: o => (o.contragent?.name ?? o.employee?.name ?? '—').replace(/\|/g, '/'),
        },
        { header: 'Kiritgan', value: o => (o.created_user?.name ?? '—').replace(/\|/g, '/') },
        { header: 'Izoh', value: o => (o.comment ?? '—').replace(/\|/g, '/').slice(0, 300) },
      ]

      const shownTotals = perCurrency
        .rows()
        .map(t => `${money(t.values.amount, t.currency)}`)
        .join(' · ')

      return text(
        `**Operatsiyalar** · ${formatDate(range.from_date)} — ${formatDate(range.to_date)}` +
          (type ? ` · ${type === 'in' ? 'kirim' : 'chiqim'}` : ''),
        table(shown, columns),
        `**Butun filtr bo'yicha jami:** ${money(totals.total_amount, 'uzs')} ` +
          `_(API agregati — so'mdagi hisoblar; dollar hisoblari uchun account_id bilan alohida so'rang)_`,
        `**Ko'rsatilgan qatorlar jami:** ${shownTotals}`,
        note,
      )
    }),
  )

  // ═══ 3. Qarzdor mijozlar ═══════════════════════════════════════════════════
  server.registerTool(
    'qarzdor_mijozlar',
    {
      title: 'Qarzdor mijozlar',
      description:
        "Qarzga savdo mijozlari va ularning saldosi. \"Kimning qarzi bor\", " +
        '"eng katta qarzdorlar", "X ismli mijozning qarzi qancha" kabi savollarda. ' +
        'Saldo MUSBAT bo\'lsa mijoz qarzdor (bizga qarzi bor), manfiy bo\'lsa ortiqcha ' +
        'to\'lagan. Sana oralig\'i talab qilinmaydi — bu joriy holat. ' +
        'Ro\'yxat saldo bo\'yicha saralanmaydi: qatorlar kesilgan bo\'lsa "eng katta ' +
        'qarzdorlar" ko\'rsatilmay qolgan bo\'lishi mumkin — ism/filial bilan toraytiring.',
      inputSchema: {
        name: z.string().optional().describe('Ism bo\'yicha qidirish (qismiy moslik).'),
        phone: z.string().optional().describe("Telefon bo'yicha qidirish, 9 xonali (masalan 901234567)."),
        warehouse_id: warehouseId,
        only_debtors: z
          .boolean()
          .optional()
          .describe("true — faqat yopilmagan qarzi borlar. Standart: hammasi."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    safe(async ({ name, phone, warehouse_id, only_debtors }, extra) => {
      const session = sessionFrom(extra)
      interface DebtClient {
        id?: number
        name?: string
        phone?: string
        saldo?: number | string
        currency?: string
        comment?: string
        warehouse?: { name?: string }
      }

      const list = await xpert.get<Paginated<DebtClient>>(session, '/debts/debt-clients', {
        name,
        phone,
        warehouse_id,
        debtor: only_debtors ? 1 : undefined,
        relations: 'warehouse',
        // Saldo bazadagi ustun emas, model accessor'i (`getSaldoAttribute`) —
        // so'ralmasa javobga umuman kirmaydi.
        appends: 'saldo',
        per_page: config.maxRows,
        page: 1,
      })

      const rows = asArray<DebtClient>(list.data)
      const { shown, note } = limitRows(rows, list.total)

      if (!shown.length) return text('**Qarzdor mijozlar**', 'Mijoz topilmadi.')

      const totals = new CurrencyTotals(['saldo'] as const)
      for (const c of shown) totals.add(c.currency, { saldo: c.saldo })

      const columns: Column<DebtClient>[] = [
        { header: 'Mijoz', value: c => c.name ?? '—' },
        { header: 'Telefon', value: c => (c.phone ? `+998${c.phone}` : '—') },
        { header: 'Saldo', align: 'right', value: c => money(c.saldo, c.currency) },
        { header: 'Filial', value: c => c.warehouse?.name ?? '—' },
        { header: 'Izoh', value: c => (c.comment ?? '—').replace(/\|/g, '/').slice(0, 40) },
      ]

      const summary = totals
        .rows()
        .map(t => `**${t.currency.toUpperCase()}**: ${money(t.values.saldo, t.currency)}`)
        .join(' · ')

      return text(
        `**Qarzdor mijozlar** — ${list.total ?? shown.length} ta`,
        table(shown, columns),
        `**Ko'rsatilganlarning saldo yig'indisi:** ${summary}`,
        note,
      )
    }),
  )

  // ═══ 4. Shartnoma qidirish ═════════════════════════════════════════════════
  server.registerTool(
    'shartnoma_qidir',
    {
      title: 'Shartnomalarni qidirish',
      description:
        'Muddatli to\'lov (kredit) shartnomalarini qidiradi va har biri uchun tannarx, ' +
        'oldindan to\'lov, kredit, jami sotuv, to\'langan, qolgan qarz va foydani qaytaradi. ' +
        '"Alisherning shartnomasi", "muddati o\'tgan shartnomalar", "shu oyda tuzilgan ' +
        'shartnomalar", "shartnomalardan qancha foyda bo\'lgan", "kimning qolgan qarzi ko\'p" ' +
        'kabi savollarda. ' +
        'BEKOR QILINGAN shartnomalar standart holda HISOBGA OLINMAYDI — ular amalga oshmagan ' +
        'savdo, tovari omborga qaytarilgan, puli mijozga qaytarilgan. Ularni ko\'rish kerak ' +
        'bo\'lsa `rejected` ni bering. ' +
        'Bitta shartnomaning to\'liq tafsilotini olish uchun keyin `shartnoma_kor` ni chaqiring.',
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Ism, familiya, telefon yoki shartnoma raqami bo\'yicha erkin qidiruv.'),
        status: z
          .number()
          .int()
          .min(1)
          .max(2)
          .optional()
          .describe(
            "1 — aktiv (qarzi bor), 2 — yopilgan (to'lab bo'lingan). " +
              'Bekor qilinganlik alohida belgi — buning uchun `rejected` dan foydalaning.',
          ),
        rejected: z
          .enum(['exclude', 'include', 'only'])
          .optional()
          .describe(
            "Bekor qilingan shartnomalarni nima qilish: 'exclude' (standart) — chiqarilmaydi " +
              "va jamiga qo'shilmaydi, 'include' — ro'yxatga qo'shiladi (lekin jamiga baribir " +
              "kirmaydi), 'only' — faqat bekor qilinganlar. " +
              "Foydalanuvchi bekor qilinganlarni ham so'rasa 'include', " +
              "faqat bekor qilinganlarni so'rasa 'only' bering.",
          ),
        is_overdue: z
          .boolean()
          .optional()
          .describe("true — faqat muddati o'tgan qarzi bor shartnomalar."),
        warehouse_id: warehouseId,
        page: z.number().int().positive().optional().describe('Sahifa raqami (standart 1).'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    safe(async ({ search, status, rejected, is_overdue, warehouse_id, page }, extra) => {
      const session = sessionFrom(extra)
      interface Contract {
        id?: number
        status?: number
        confirmation_status?: number
        is_rejected?: number | boolean
        currency?: string
        is_dollar?: number | boolean
        credit_amount?: number | string
        in_advance_payment_amount?: number | string
        all_payment_amount?: number | string
        credit_months?: number | string
        start_date?: string
        end_date?: string
        client?: { firstname?: string; lastname?: string; middlename?: string; phone?: string }
        warehouse?: { name?: string }
        products?: Array<{ cost?: number | string | null; cost_dollar?: number | string | null }>
      }

      // EzguTech'da `status` faqat 1/2; bekor qilinganlik alohida `is_rejected` bayrog'i.
      const STATUS: Record<number, string> = {
        1: 'Aktiv',
        2: 'Yopilgan',
      }

      const isRejected = (c: Contract): boolean => toNumber(c.is_rejected) === 1

      const statusLabel = (c: Contract): string => {
        if (isRejected(c)) return 'Bekor qilingan'

        const base = STATUS[toNumber(c.status)] ?? "Noma'lum"

        // confirmation_status = 1 — hali tasdiqlanmagan, ya'ni savdo yakunlanmagan.
        return toNumber(c.confirmation_status) === 1 ? `${base} (tasdiqlanmagan)` : base
      }

      // Standart 'exclude': bekor qilinganlar API darajasida kesiladi, ya'ni
      // `total` ham, keyingi sahifalar ham ularsiz keladi.
      const rejectedMode = rejected ?? 'exclude'
      const is_rejected = rejectedMode === 'include' ? undefined : rejectedMode === 'only' ? 1 : 0

      const list = await xpert.get<Paginated<Contract>>(session, '/contracts', {
        search,
        status,
        is_rejected,
        is_overdue: is_overdue ? 1 : undefined,
        warehouse_id,
        // `products` — faqat tannarx (kirim narxi) uchun
        relations: 'client|warehouse|products',
        per_page: config.maxRows,
        page: page ?? 1,
        sort_key: 'id',
        sort_type: 'desc',
      })

      const rows = asArray<Contract>(list.data)
      const { shown, note } = limitRows(rows, list.total)

      if (!shown.length) return text('**Shartnomalar**', 'Shartnoma topilmadi.')

      const currencyOf = (c: Contract): string =>
        c.currency === 'usd' || c.is_dollar ? 'usd' : 'uzs'

      /**
       * Bitta shartnomaning pul ko'rsatkichlari — hammasi shartnoma valyutasida.
       *
       * `credit_amount` backendda "tovarlar − chegirma − oldindan to'lov" deb
       * hisoblanadi, shuning uchun jami sotuv = kredit + oldindan to'lov.
       * Qolgan = kredit − to'langan (backend KPI hisobotidagi formula).
       *
       * Tannarx `null` bo'lsa — noma'lum, 0 emas:
       *   - bekor qilinganda tovar omborga qaytgan, `products` bo'sh keladi;
       *   - USD shartnomada biror tovarning `cost_dollar` i yozilmagan — qisman
       *     yig'indi chalg'itadi, kurs esa bu yerda yo'q.
       */
      const figuresOf = (c: Contract) => {
        const cur = currencyOf(c)
        const credit = toNumber(c.credit_amount)
        const advance = toNumber(c.in_advance_payment_amount)
        const paid = toNumber(c.all_payment_amount)
        const sale = credit + advance

        const costs = (c.products ?? []).map(p => (cur === 'usd' ? p.cost_dollar : p.cost))
        const costKnown =
          costs.length > 0 && costs.every(v => v !== null && v !== undefined && v !== '')
        const cost: number | null = costKnown
          ? costs.reduce<number>((sum, v) => sum + toNumber(v), 0)
          : null

        return {
          cur,
          credit,
          advance,
          paid,
          sale,
          remaining: Math.max(credit - paid, 0),
          cost,
          profit: cost === null ? null : sale - cost,
        }
      }

      const entries = shown.map(c => ({ c, f: figuresOf(c) }))
      type Entry = (typeof entries)[number]

      const amount = (value: number | null, cur: string): string =>
        value === null ? '—' : money(value, cur)

      const columns: Column<Entry>[] = [
        { header: '№', value: ({ c }) => String(c.id ?? '—') },
        {
          header: 'Mijoz',
          value: ({ c }) =>
            [c.client?.lastname, c.client?.firstname, c.client?.middlename]
              .filter(Boolean)
              .join(' ') || '—',
        },
        { header: 'Telefon', value: ({ c }) => (c.client?.phone ? `+998${c.client.phone}` : '—') },
        { header: 'Tannarx', align: 'right', value: ({ f }) => amount(f.cost, f.cur) },
        { header: 'Oldindan', align: 'right', value: ({ f }) => money(f.advance, f.cur) },
        { header: 'Kredit', align: 'right', value: ({ f }) => money(f.credit, f.cur) },
        { header: 'Jami sotuv', align: 'right', value: ({ f }) => money(f.sale, f.cur) },
        { header: "To'langan", align: 'right', value: ({ f }) => money(f.paid, f.cur) },
        { header: 'Qolgan', align: 'right', value: ({ f }) => money(f.remaining, f.cur) },
        { header: 'Foyda', align: 'right', value: ({ f }) => amount(f.profit, f.cur) },
        { header: 'Muddat', align: 'right', value: ({ c }) => `${plain(c.credit_months)} oy` },
        { header: 'Boshlanish', value: ({ c }) => formatDate(c.start_date) },
        { header: 'Holat', value: ({ c }) => statusLabel(c) },
        { header: 'Filial', value: ({ c }) => c.warehouse?.name ?? '—' },
      ]

      // Bekor qilingani jamiga qo'shilmaydi: u amalga oshmagan savdo.
      // 'only' rejimida esa aynan o'sha summa so'ralgan.
      const counted = rejectedMode === 'only' ? entries : entries.filter(e => !isRejected(e.c))
      const rejectedCount = entries.length - counted.length

      const totals = new CurrencyTotals([
        'cost',
        'advance',
        'credit',
        'sale',
        'paid',
        'remaining',
        'profit',
      ] as const)

      // Tannarxi noma'lum shartnoma tannarx/foyda jamiga kirmaydi, qolgan
      // ustunlarga kiradi — nechtasi shunday ekani pastda aytiladi. Valyutada
      // birorta ham ma'lum tannarx bo'lmasa, jami "0" emas "—" bo'ladi.
      let unknownCost = 0
      const knownCostByCurrency = new Map<string, number>()
      for (const { f } of counted) {
        if (f.cost === null) unknownCost += 1
        else knownCostByCurrency.set(f.cur, (knownCostByCurrency.get(f.cur) ?? 0) + 1)

        totals.add(f.cur, {
          cost: f.cost ?? 0,
          advance: f.advance,
          credit: f.credit,
          sale: f.sale,
          paid: f.paid,
          remaining: f.remaining,
          profit: f.profit ?? 0,
        })
      }

      const summary = totals.isEmpty()
        ? '0'
        : totals
            .rows()
            .map(t => {
              const m = (v: number): string => money(v, t.currency)
              const hasCost = (knownCostByCurrency.get(t.currency) ?? 0) > 0

              return (
                `- **${t.currency.toUpperCase()}** — tannarx: ${hasCost ? m(t.values.cost) : '—'}, ` +
                `oldindan: ${m(t.values.advance)}, kredit: ${m(t.values.credit)}, ` +
                `jami sotuv: ${m(t.values.sale)}, to'langan: ${m(t.values.paid)}, ` +
                `qolgan: ${m(t.values.remaining)}, foyda: ${hasCost ? m(t.values.profit) : '—'}`
              )
            })
            .join('\n')

      const notes = [
        rejectedMode === 'only'
          ? '_Bekor qilingan shartnomalar summasi — real savdo emas._'
          : rejectedCount
            ? `_${rejectedCount} ta bekor qilingan shartnoma jamiga qo'shilmadi._`
            : null,
        unknownCost
          ? `_${unknownCost} ta shartnomada tannarx aniqlanmadi (tovar yo'q yoki shartnoma ` +
            "valyutasidagi kirim narxi yozilmagan) — ular tannarx va foyda jamiga kirmadi._"
          : null,
      ]
        .filter(Boolean)
        .join('\n')

      const scope =
        rejectedMode === 'only'
          ? ' · faqat bekor qilinganlar'
          : rejectedMode === 'include'
            ? ' · bekor qilinganlar ham ro\'yxatda'
            : ' · bekor qilinganlarsiz'

      return text(
        `**Shartnomalar** — jami topilgani ${list.total ?? shown.length} ta${scope}`,
        table(entries, columns),
        `**Ko'rsatilganlar jami (valyuta bo'yicha alohida):**\n${summary}`,
        notes || null,
        note,
      )
    }),
  )

  // ═══ 5. Bitta shartnoma ════════════════════════════════════════════════════
  server.registerTool(
    'shartnoma_kor',
    {
      title: 'Shartnoma tafsiloti',
      description:
        "Bitta shartnomaning to'liq ma'lumoti: mijoz, mahsulotlar, shartlar, to'lov holati, " +
        "tovar TANNARXI va FOYDASI, hamda qurilma qaysi QULFLASH SERVISlariga ulangani. " +
        'Quyidagi kabi savollarda ham shu tool chaqiriladi: "bu shartnomaning tannarxi qancha", ' +
        '"shundan qancha foyda bo\'lgan", "telefon bloklanganmi", "qaysi servisga ulangan", ' +
        '"avto-blok yoqilganmi". ' +
        "ID ni `shartnoma_qidir` dan olasiz.",
      inputSchema: {
        id: z.number().int().positive().describe('Shartnoma ID (raqami).'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    safe(async ({ id }, extra) => {
      const session = sessionFrom(extra)

      interface ContractProduct {
        id?: number
        name?: string
        seria?: string
        as_bonus?: number | boolean
        cost?: number | string | null
        cost_dollar?: number | string | null
        price_with_percent?: number | string | null
        price_with_percent_dollar?: number | string | null
        category?: { name?: string }
      }

      /**
       * Qulflash servislarining umumiy shakli. EzguTech'da shartnomaga ikkita
       * servis bog'langan: Mobilock va 7MDM. Ustun nomlari farq qiladi
       * (Mobilock'da `serial_number`, 7MDM'da `sn`), shuning uchun hammasi ixtiyoriy.
       */
      interface LockDevice {
        product_id?: number
        status?: number | string
        status_name?: string
        auto_block?: number | null
        imei?: string | null
        imei_1?: string | null
        imei_2?: string | null
        serial_number?: string | null
        sn?: string | null
      }

      interface ContractDetail {
        id?: number
        status?: number
        confirmation_status?: number
        is_rejected?: number | boolean
        rejected_at?: string
        rejection_reason?: string
        currency?: string
        is_dollar?: number | boolean
        credit_amount?: number | string
        in_advance_payment_amount?: number | string
        all_payment_amount?: number | string
        credit_months?: number | string
        credit_payment_day?: number | string
        start_date?: string
        end_date?: string
        client?: {
          firstname?: string
          lastname?: string
          middlename?: string
          phone?: string
          address?: string
        }
        warehouse?: { name?: string }
        collector?: { name?: string }
        operator?: { name?: string }
        created_user?: { name?: string }
        products?: ContractProduct[]
        mobilelock_devices?: LockDevice[]
        seven_mdm_devices?: LockDevice[]
      }

      // Faqat EzguTech `Contract` modelida bor relation'lar: yo'q relation
      // so'ralsa API butun so'rovni 500 bilan rad etadi.
      const c = await xpert.get<ContractDetail>(session, `/contracts/${id}`, {
        relations:
          'client|warehouse|collector|operator|createdUser|products.category|' +
          'mobilelockDevices|sevenMdmDevices',
      })

      const cur = c.currency === 'usd' || c.is_dollar ? 'usd' : 'uzs'
      const credit = toNumber(c.credit_amount)
      const paid = toNumber(c.all_payment_amount)

      const STATUS: Record<number, string> = { 1: 'Aktiv', 2: 'Yopilgan' }

      const rejectedAt = formatDate(c.rejected_at)
      const state = toNumber(c.is_rejected) === 1
        ? `**BEKOR QILINGAN**${rejectedAt !== '—' ? ` (${rejectedAt})` : ''}` +
          (c.rejection_reason ? ` — sabab: ${c.rejection_reason}` : '') +
          '. Bu shartnoma amalga oshmagan: tovar omborga, pul mijozga qaytarilgan. ' +
          'Savdo hisobotlariga qo\'shilmasin.'
        : (STATUS[toNumber(c.status)] ?? "noma'lum holat") +
          (toNumber(c.confirmation_status) === 1 ? ' (tasdiqlanmagan)' : '')

      const productRows = c.products ?? []

      /**
       * Tannarx va sotuv narxi SHARTNOMA VALYUTASIDAGI ustundan olinadi.
       * `*_dollar` ustunlari sotuv kunidagi kursda yozilgan — so'mdagi qiymatni
       * joriy kursga bo'lish boshqa raqam berardi, kurs esa bu yerda yo'q.
       * Shuning uchun kerakli ustun bo'sh bo'lsa qiymat "yo'q" deb qoldiriladi,
       * o'zimiz konvertatsiya qilmaymiz.
       */
      const pick = (uzs: unknown, usd: unknown): number | null => {
        const raw = cur === 'usd' ? usd : uzs

        return raw === null || raw === undefined || raw === '' ? null : toNumber(raw)
      }

      const costOf = (p: ContractProduct): number | null => pick(p.cost, p.cost_dollar)

      const saleOf = (p: ContractProduct): number | null =>
        pick(p.price_with_percent, p.price_with_percent_dollar)

      const amount = (value: number | null): string => (value === null ? '—' : money(value, cur))

      const productName = (p: ContractProduct): string =>
        `${(p.category?.name ?? p.name ?? '—').replace(/\|/g, '/')}` +
        `${toNumber(p.as_bonus) === 1 ? ' _(bonus)_' : ''}`

      const costTotal = productRows.reduce((sum, p) => sum + (costOf(p) ?? 0), 0)
      const saleTotal = productRows.reduce((sum, p) => sum + (saleOf(p) ?? 0), 0)
      const profit = saleTotal - costTotal
      const margin = saleTotal > 0 ? ` (marja ${((profit / saleTotal) * 100).toFixed(1)}%)` : ''
      const incomplete = productRows.filter(p => costOf(p) === null || saleOf(p) === null).length

      const productColumns: Column<ContractProduct>[] = [
        { header: 'Mahsulot', value: productName },
        { header: 'Seriya', value: p => (p.seria ?? '—').replace(/\|/g, '/') },
        { header: 'Tannarx', align: 'right', value: p => amount(costOf(p)) },
        { header: 'Sotuv', align: 'right', value: p => amount(saleOf(p)) },
        {
          header: 'Foyda',
          align: 'right',
          value: p => {
            const cost = costOf(p)
            const sale = saleOf(p)

            return cost === null || sale === null ? '—' : money(sale - cost, cur)
          },
        },
      ]

      // Bekor qilinganda tovarning `contract_id` si bo'shatiladi (omborga qaytadi),
      // shuning uchun ro'yxat bo'sh keladi — bu 0 so'm tannarx degani emas.
      const productsSection = productRows.length
        ? [
            '**Mahsulotlar (tannarx va foyda):**',
            table(productRows, productColumns),
            `**Jami tannarx:** ${money(costTotal, cur)} · **Jami sotuv:** ${money(saleTotal, cur)} · ` +
              `**Foyda:** ${money(profit, cur)}${margin}`,
            incomplete
              ? `_${incomplete} ta tovarda shartnoma valyutasidagi (${cur.toUpperCase()}) narx ` +
                'yozilmagan — ular jamiga kirmadi._'
              : null,
          ]
            .filter(Boolean)
            .join('\n\n')
        : toNumber(c.is_rejected) === 1
          ? '**Mahsulotlar:** shartnoma bekor qilingan — tovarlar omborga qaytarilgan, ' +
            'tannarx va foyda hisoblanmaydi.'
          : '**Mahsulotlar:** tovar biriktirilmagan.'

      // ── Qulflovchi servislar ────────────────────────────────────────────────
      const productById = new Map<number, ContractProduct>()
      for (const p of productRows) {
        if (p.id) productById.set(p.id, p)
      }

      const lockRows = (
        [
          ['Mobilock', c.mobilelock_devices],
          ['7MDM', c.seven_mdm_devices],
        ] as const
      ).flatMap(([service, devices]) =>
        (devices ?? []).map(device => ({ service, device })),
      )

      const deviceLabel = (d: LockDevice): string => {
        const p = d.product_id ? productById.get(d.product_id) : undefined

        if (!p) return '—'

        const name = (p.category?.name ?? p.name ?? '—').replace(/\|/g, '/')

        return p.seria ? `${name} (${p.seria.replace(/\|/g, '/')})` : name
      }

      const imeiOf = (d: LockDevice): string => {
        const imeis = [d.imei_1, d.imei_2, d.imei].filter(Boolean)

        return imeis.length ? imeis.join(' / ') : (d.serial_number ?? d.sn ?? '—')
      }

      const autoBlockOf = (d: LockDevice): string => {
        if (d.auto_block === null || d.auto_block === undefined) return '—'

        return toNumber(d.auto_block) === 1 ? 'Ha' : "Yo'q"
      }

      const locksSection = lockRows.length
        ? '**Qulflovchi servislar:**\n\n' +
          table(lockRows, [
            { header: 'Qurilma', value: r => deviceLabel(r.device) },
            { header: 'Servis', value: r => r.service },
            { header: 'Holat', value: r => r.device.status_name ?? String(r.device.status ?? '—') },
            { header: 'IMEI', value: r => imeiOf(r.device) },
            { header: 'Avto-blok', value: r => autoBlockOf(r.device) },
          ])
        : '**Qulflovchi servislar:** qurilma hech qanday qulflash servisiga ulanmagan ' +
          '(Mobilock va 7MDM bo\'yicha yozuv yo\'q).'

      return text(
        `**Shartnoma #${c.id ?? id}** — ${state}`,
        [
          `**Mijoz:** ${[c.client?.lastname, c.client?.firstname, c.client?.middlename].filter(Boolean).join(' ') || '—'}`,
          `**Telefon:** ${c.client?.phone ? `+998${c.client.phone}` : '—'}`,
          `**Manzil:** ${c.client?.address ?? '—'}`,
          `**Filial:** ${c.warehouse?.name ?? '—'}`,
          `**Undiruvchi:** ${c.collector?.name ?? '—'}`,
          `**Operator:** ${c.operator?.name ?? '—'}`,
          `**Yaratdi:** ${c.created_user?.name ?? '—'}`,
        ].join('\n'),
        [
          `**Oldindan to'lov:** ${money(c.in_advance_payment_amount, cur)}`,
          `**Kredit summasi:** ${money(credit, cur)}`,
          `**To'langan:** ${money(paid, cur)}`,
          `**Qolgan:** ${money(Math.max(credit - paid, 0), cur)}`,
          `**Muddat:** ${plain(c.credit_months)} oy, to'lov kuni: ${c.credit_payment_day ?? '—'}`,
          `**Oraliq:** ${formatDate(c.start_date)} — ${formatDate(c.end_date)}`,
        ].join('\n'),
        productsSection,
        locksSection,
      )
    }),
  )

  // ═══ 6. Omborlar (yordamchi) ═══════════════════════════════════════════════
  server.registerTool(
    'omborlar',
    {
      title: 'Omborlar / filiallar ro\'yxati',
      description:
        "Ombor va filiallarning ID va nomlari. Boshqa tool'larda `warehouse_id` " +
        'kerak bo\'lganda avval shuni chaqirib, foydalanuvchi aytgan nomni ID ga aylantiring ' +
        '(masalan "yunusobod 13" → ID).',
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    safe(async (_args, extra) => {
      const session = sessionFrom(extra)
      interface Warehouse {
        id?: number
        name?: string
        address?: string
      }

      const list = await xpert.get<Paginated<Warehouse>>(session, '/warehouses/warehouses', {
        per_page: 200,
        page: 1,
      })

      const rows = asArray<Warehouse>(list.data)

      if (!rows.length) return text('**Omborlar**', 'Ombor topilmadi.')

      return text(
        `**Omborlar** — ${rows.length} ta`,
        table(rows, [
          { header: 'ID', align: 'right', value: w => String(w.id ?? '—') },
          { header: 'Nomi', value: w => w.name ?? '—' },
          { header: 'Manzil', value: w => (w.address ?? '—').replace(/\|/g, '/').slice(0, 60) },
        ]),
      )
    }),
  )

  // ═══ 7. Hisoblar (yordamchi) ═══════════════════════════════════════════════
  server.registerTool(
    'hisoblar',
    {
      title: 'Moliyaviy hisoblar ro\'yxati',
      description:
        "Kassa/bank hisoblarining ID, nomi va valyutasi. `moliyaviy_operatsiyalar` " +
        "da `account_id` kerak bo'lganda avval shuni chaqiring.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    safe(async (_args, extra) => {
      const session = sessionFrom(extra)
      interface Account {
        id?: number
        name?: string
        currency?: string
        warehouse?: { name?: string }
      }

      const list = await xpert.get<Paginated<Account>>(session, '/finance/accounts', {
        per_page: 200,
        page: 1,
        relations: 'warehouse',
      })

      const rows = asArray<Account>(list.data)

      if (!rows.length) return text('**Hisoblar**', 'Hisob topilmadi.')

      return text(
        `**Moliyaviy hisoblar** — ${rows.length} ta`,
        table(rows, [
          { header: 'ID', align: 'right', value: a => String(a.id ?? '—') },
          { header: 'Nomi', value: a => a.name ?? '—' },
          { header: 'Valyuta', value: a => (a.currency ?? 'uzs').toUpperCase() },
          { header: 'Ombor', value: a => a.warehouse?.name ?? '—' },
        ]),
      )
    }),
  )
}
