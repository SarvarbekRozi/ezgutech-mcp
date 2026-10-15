# xpert-mcp

EZGUTECH CRM hisobotlarini Claude'ga **faqat o'qish** uchun ochadigan MCP server.
claude.ai'ga custom connector sifatida ulanadi — har xodim o'z EzguTech hisobi
bilan kiradi, hech narsa o'rnatmaydi.

> — Bugun kassaga qancha tushdi, filiallar bo'yicha ayt
> — Eng katta qarzi bor mijozlarni ko'rsat
> — Yunusobod 13 da shu oy qancha chiqim bo'lgan, nimalarga?

`abbot-mcp` dan ko'chirilgan. Fayl tuzilishi ataylab bir xil qoldirilgan —
Abbot'dagi tuzatishni bu yerga (yoki aksincha) `diff` bilan ko'chirish oson
bo'lsin. Farqlar 5-bo'limda.

---

## 1. Tez sinash (cloudflared tunnel, ~3 daqiqa)

claude.ai serverga **internetdan** kirishi kerak, shuning uchun `localhost`
yaramaydi. Deploy qilmasdan sinash uchun tunnel ochamiz.

```bash
cd D:/loyiha/xpert-mcp
npm install
npm run build
```

**1-terminal — tunnel ochamiz:**

```bash
cloudflared tunnel --url http://localhost:8788
```

`cloudflared` yo'q bo'lsa: `winget install Cloudflare.cloudflared`.
Buyruq `https://xxxx-yyyy.trycloudflare.com` kabi manzil beradi — nusxa olib qo'ying.

**2-terminal — `.env` yasab, serverni ishga tushiramiz:**

```bash
cp .env.example .env
```

`.env` da faqat shular kerak (tunnel manzilini o'zingiznikiga almashtiring):

```
XPERT_TRANSPORT=http
XPERT_API_URL=https://api.ezgutech.uz/api/v1
XPERT_PUBLIC_URL=https://xxxx-yyyy.trycloudflare.com
```

```bash
npm start
```

**3. claude.ai da ulash:**

Settings → Connectors → **Add custom connector** → URL:

```
https://xxxx-yyyy.trycloudflare.com/mcp
```

Claude o'zi OAuth oqimini boshlaydi: brauzerda EZGUTECH login formasi chiqadi,
o'z login/parolingizni kiritasiz — tayyor.

**4. Birinchi savol** (eng arzon so'rov, login va ruxsat ishlashini tasdiqlaydi):

> EzguTech'dagi omborlar ro'yxatini ko'rsat

> ⚠️ `trycloudflare.com` manzili har ishga tushirishda o'zgaradi. O'zgargach
> `XPERT_PUBLIC_URL` ni yangilab, serverni qayta ishga tushiring va claude.ai da
> connectorni qayta qo'shing. Doimiy ishlatish uchun 3-bo'limga qarang.

---

## 2. Nima uchun shunday qurilgan

| Qaror | Sabab |
|---|---|
| Bazaga emas, **HTTP API** ga boradi | Rol va filial (`warehouse_id`) bo'yicha cheklov backenddagi holicha ishlaydi. Biznes-mantiqni ikkinchi joyda qayta yozish kerak emas. |
| Har xodim **o'z login/paroli** bilan kiradi | Ruxsatlar avtomatik amal qiladi: `is_main` bo'lmagan xodim boshqa filialning kassasini Claude orqali ham ko'ra olmaydi. Umumiy "servis" hisobi bu himoyani buzardi. |
| Kesh va rate limit **foydalanuvchi bo'yicha** ajratilgan | Bu optimizatsiya emas, xavfsizlik: umumiy kesh kaliti bilan A xodimning javobi B ga qaytib ketardi. |
| Faqat `GET` (login'dan boshqa) | Model noaniq buyruqni tushunib ma'lumotni o'zgartirib qo'yishi mumkin emas. Barcha tool'da `readOnlyHint: true`. |
| Sana oralig'i ≤ 366 kun | Model "bu yil qanday ketdi?" da butun yilni so'rashga moyil. `account-operations` har hisob uchun 4 ta agregat subquery bajaradi — keng oraliq bazani og'irlashtiradi. Cheklov **API'ga bormasdan** ishlaydi. |
| Kesh 90 s | Claude bitta suhbat ichida bir xil so'rovni ko'p marta yuboradi. |
| Rate limit 20/min | Model sikliga tushib qolsa server yiqilmaydi. |
| `trust proxy` — aniq son, `true` emas | `true` bilan soxta `X-Forwarded-For` yuborib rate-limit chetlab o'tiladi. |
| Javobda **valyutalar alohida** | So'm va dollarni qo'shish ma'nosiz raqam beradi. Jamilar UZS/USD bo'yicha ajratilgan, model ko'rsatmasida ham yozilgan. |
| Jamilar **bazada** hisoblanadi | Xom qatorlarni modelga tashlab "o'zi qo'shsin" deyish — kontekstni to'ldiradi va xato beradi. `totals=amount` ishlatiladi. |
| Kesilgan ro'yxat **aytiladi** | Jimgina kesish eng yomoni: model to'liq ma'lumot ko'rgan deb o'ylaydi. Nechtasi ko'rsatilmagani javobda yoziladi. |
| Parollar **diskka yozilmaydi** | Faqat RAM'da, faqat EzguTech JWT'si (6 soat) muddati o'tganda qayta login uchun. Server qayta ishga tushsa xodimlar qaytadan kiradi. |

---

## 3. Serverga qo'yish (deploy)

Tunnel — faqat sinash uchun. Doimiy ishlatishda quyidagi tartib.

### 3.1 Talablar

| Nima | Izoh |
|---|---|
| **Node.js ≥ 20.6** | `node -v` bilan tekshiring. Kamroq bo'lsa `nvm install 22`. |
| **Domen** | `mcp.ezgutech.uz` → serverning IP manzili (A yozuvi) |
| **443-port ochiq** | 8788 esa **tashqariga ochilmasin** — unga faqat nginx murojaat qiladi |
| **nginx + certbot** | TLS uchun. claude.ai HTTPS'siz ulanmaydi. |

EzguTech backendi turgan serverga qo'ysangiz ham bo'ladi — bu alohida Node
jarayoni, PHP kodiga tegmaydi. Shu serverda `abbot-mcp` ham tursa, u 8787 da,
bu 8788 da ishlaydi — to'qnashmaydi.

### 3.2 Kodni serverga olib chiqish

```bash
git clone <repo> /opt/xpert-mcp && cd /opt/xpert-mcp
npm ci
npm run build
```

`git` ishlatmasangiz, papkani `node_modules` va `dist` siz nusxalab,
serverda `npm ci && npm run build` qiling.

### 3.3 `.env`

```bash
cp .env.example .env && nano .env
```

O'zgaradigan qatorlar:

```
XPERT_TRANSPORT=http
XPERT_API_URL=https://api.ezgutech.uz/api/v1
XPERT_PUBLIC_URL=https://mcp.ezgutech.uz
XPERT_STATUS_ORIGINS=https://crm.ezgutech.uz
TRUST_PROXY_HOPS=1
```

`XPERT_PUBLIC_URL` — eng muhim qator. OAuth manzillari va redirect shunga
tayanadi; xato bo'lsa claude.ai ulanmaydi. `=` dan keyin bo'sh joy qoldirmang.

`XPERT_STATUS_ORIGINS` — CRM'ning "Integratsiyalar" sahifasi ulanish holatini
shu origin'dan so'raydi (6-bo'lim). Bo'sh qolsa CRM holatni bilolmaydi.

Faylni himoyalang — server qayta ishga tushganda bu yerdan hech qanday parol
o'qilmaydi, lekin baribir:

```bash
chmod 600 .env
```

### 3.4 nginx

```nginx
server {
    listen 443 ssl http2;
    server_name mcp.ezgutech.uz;

    # certbot --nginx -d mcp.ezgutech.uz  buni o'zi to'ldiradi
    # ssl_certificate ...

    location / {
        proxy_pass http://127.0.0.1:8788;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # MCP javoblari SSE oqimi bo'lishi mumkin — buferlash o'chiriladi,
        # aks holda Claude javobni kutib qotib qoladi
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

```bash
nginx -t && systemctl reload nginx
certbot --nginx -d mcp.ezgutech.uz
```

### 3.5 pm2 bilan ishga tushirish

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup     # chiqqan buyruqni nusxalab bajaring
```

`ecosystem.config.cjs` da `instances: 1` va `exec_mode: 'fork'` —
**o'zgartirmang**. Cluster rejimida bir nechta ishchi bo'ladi, OAuth tokenlari
esa har birining o'z xotirasida — foydalanuvchi bir ishchida login qilib,
keyingi so'rovi boshqasiga tushsa "token yaroqsiz" xatosi chiqadi.

### 3.6 Tekshirish

```bash
curl https://mcp.ezgutech.uz/healthz
```

`{"ok":true,...}` va `publicUrl` to'g'ri chiqishi kerak. Keyin:

```bash
curl -s https://mcp.ezgutech.uz/.well-known/oauth-protected-resource
```

### 3.7 claude.ai

Settings → Connectors → Add custom connector:

```
https://mcp.ezgutech.uz/mcp
```

Tunnel bilan qo'shgan eski connectorni **o'chiring** — uning manzili endi
ishlamaydi.

### 3.8 Yangilanish chiqarish

```bash
cd /opt/xpert-mcp && git pull && npm ci && npm run build && pm2 restart xpert-mcp
```

> ⚠️ `npm run build` ni tashlab ketmang. Ishlab turgan Node jarayoni modulni
> xotirasida saqlaydi — faqat `pm2 restart` qilsangiz eski kod qayta
> ko'tariladi.

> Qayta ishga tushirish RAM'dagi sessiyalarni o'chiradi — xodimlar
> connectorni qaytadan ulaydi (bir marta login). Deploy'ni ish vaqtidan
> tashqarida qiling.

### systemd (pm2 o'rniga)

```ini
# /etc/systemd/system/xpert-mcp.service
[Unit]
Description=EZGUTECH MCP server
After=network.target

[Service]
Type=simple
User=xpert
WorkingDirectory=/opt/xpert-mcp
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/opt/xpert-mcp/.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now xpert-mcp
```

---

## 4. Tekshirish

**Protokol + OAuth (haqiqiy EzguTech hisobi kerak emas — soxta API bilan):**

```bash
npm run smoke:http
```

metadata → `/register` → `/authorize` → login formasi → `/token` → PKCE →
MCP `initialize` → `tools/list` → `tools/call` → refresh → soxta token rad
etilishi → valyutalar aralashmasligi → sana cheklovi → `/connection-status`.

**stdio rejimi va tool javoblari:**

```bash
npm run smoke
```

Soxta API EzguTech modellarida yo'q relation so'ralsa haqiqiy backend kabi 500
qaytaradi — Abbot'dan qolgan relation (`seller`, `knoxDevices`,
`payment.client` ...) qaytib kirsa test yiqiladi.

**Tirik server:**

```bash
curl https://mcp.ezgutech.uz/healthz
```

---

## 5. Tool'lar

| Tool | Endpoint | Vazifasi |
|---|---|---|
| `kassa_hisoboti` | `GET /finance/account-operations` | Hisoblar kesimida kirim/chiqim/balans |
| `moliyaviy_operatsiyalar` | `GET /finance/operations` | Operatsiyalar ro'yxati (ID, sana, kiritilgan vaqti, mijoz, shartnoma №, kiritgan, izoh) + agregat jami |
| `qarzdor_mijozlar` | `GET /debts/debt-clients` | Qarzdorlar va saldo |
| `shartnoma_qidir` | `GET /contracts` | Shartnomalarni qidirish (bekor qilinganlarsiz) + tannarx, oldindan to'lov, jami sotuv, to'langan, qolgan, foyda |
| `shartnoma_kor` | `GET /contracts/{id}` | Bitta shartnoma tafsiloti + tannarx/foyda, undiruvchi/operator va qulflash servislari |
| `omborlar` | `GET /warehouses/warehouses` | Ombor nomi → ID (yordamchi) |
| `hisoblar` | `GET /finance/accounts` | Hisob nomi → ID (yordamchi) |

Oxirgi ikkitasi muhim: Claude "yunusobod 13" ni `warehouse_id` ga aylantirishi
uchun kerak, aks holda filial bo'yicha filtrlay olmaydi.

### abbot-mcp dan farqlari

| Joy | Abbot | EzguTech | Sabab |
|---|---|---|---|
| Kassa hisoboti yo'li | `/reports/account-operations` | `/finance/account-operations` | Backend'da marshrut boshqa guruhda |
| Operatsiyada mijoz | `payment.client` | `payment.contract.client` / `payment.debtClient` | `payments` jadvalida `client_id` yo'q |
| Operatsiya vaqti | `date` (sana + vaqt) | `date` — faqat sana, vaqt `created_at` dan | `finance_operations.date` ustuni `date` turida |
| Qarzdor saldosi | — | `appends=saldo` | Saldo model accessor'i, so'ralmasa javobga kirmaydi |
| Shartnomadagi xodim | Sotuvchi (`seller`) | Undiruvchi (`collector`), operator (`operator`) | `Contract` da `seller` relation'i yo'q |
| Qulflash servislari | Mobilock, SCON IMEI, Knox, 7MDM | Mobilock, 7MDM | Shartnomaga faqat shu ikkitasi bog'langan |
| `moddiy_hisobot` | Bor | **Yo'q** | Backend'da `reports/material` endpoint'i yo'q |

`moliyaviy_operatsiyalar` mijoz va shartnoma raqamini `Operation::payment()`
relation'i orqali oladi — u xpert-api'da bo'lishi kerak (MCP bilan birga
qo'shilgan).

**P2P o'tkazmalar qamralmagan.** Hisobdan hisobga ko'chirilgan pul
`finance_operations` ga yozilmaydi — uning o'z jadvali bor
(`finance_p2p_operations`). Shuning uchun `moliyaviy_operatsiyalar` faqat kassa
kirim/chiqimini ko'rsatadi; bu tool tavsifida ham aytilgan.

**Bekor qilingan shartnomalar.** Bekor qilish yozuvni o'chirmaydi —
`contracts.is_rejected = 1` bo'ladi, tovar omborga, pul mijozga qaytariladi.
`GET /contracts` esa standart holda ularni ham qaytaradi. Shu sabab
`shartnoma_qidir` API'ga doim `is_rejected=0` yuboradi (`rejected` parametri
bilan `include` / `only` ga o'tkazish mumkin), jami summa esa hech qachon bekor
qilinganlarni sanamaydi.

Yangi tool qo'shish: `src/tools.ts` da `server.registerTool(...)`. Handler'ni
`safe(...)` bilan o'rang va sessiyani `sessionFrom(extra)` dan oling.
`relations` ga faqat EzguTech modelida bor relation yozing — yo'q relation
so'ralsa API butun so'rovni 500 bilan rad etadi.

---

## 6. CRM'dagi "Integratsiyalar" sahifasi

xpert-front `settings/integrations.vue` dagi "Claude MCP" kartasi:

- connector URL'ini ko'rsatadi va nusxalaydi (`VITE_MCP_URL` + `/mcp`);
- ulanish holatini `GET /connection-status` dan oladi. CRM foydalanuvchining
  o'z EzguTech JWT'sini yuboradi, server uni `GET /auth/me` da tekshiradi va
  faqat o'sha odamning holatini qaytaradi.

Buning uchun xpert-front `.env` da `VITE_MCP_URL=https://mcp.ezgutech.uz`,
bu serverda esa `XPERT_STATUS_ORIGINS=https://crm.ezgutech.uz` bo'lishi kerak.

---

## 7. Fayl tuzilishi

| Fayl | Vazifasi |
|---|---|
| `src/config.ts` | Muhit o'zgaruvchilari, bir joyda tekshiriladi |
| `src/xpert.ts` | EzguTech API mijozi: login, kesh, rate limit, timeout, JWT yangilash |
| `src/oauth.ts` | OAuth 2.1 provider |
| `src/login-page.ts` | EZGUTECH login formasi (HTML) |
| `src/branding.ts` | Ranglar, logotip, matnlar (xpert-front dan) |
| `src/http.ts` | Express app: OAuth router, `/mcp`, `/connection-status`, sessiya boshqaruvi |
| `src/server.ts` | MCP server nusxasi + modelga ko'rsatmalar |
| `src/tools.ts` | 7 ta tool |
| `src/session.ts` | Token → EzguTech sessiyasi |
| `src/dates.ts` | Sana tekshiruvi va oraliq cheklovi |
| `src/format.ts` | Valyuta bo'yicha jamlash, jadval, kesish |
| `src/errors.ts` | Xatoni modelga tushunarli matnga aylantirish |

---

## 8. Maxfiylik

So'ralgan ma'lumot Anthropic serverlariga chiqadi: mijoz ismi, telefoni,
moliyaviy raqamlar. `shartnoma_kor` da JSHSHIR va pasport **ataylab
chiqarilmagan** — model ularsiz ham ishlay oladi. Boshqa maydonlarni ham kerak
bo'lmasa `src/tools.ts` dan olib tashlash mumkin.

`shartnoma_kor` va `shartnoma_qidir` tovar **tannarxi va foydasini** ham
qaytaradi. Bu tijorat siri — uni yashiradigan alohida ruxsat yo'q
(`contracts.index`/`contracts.show` bo'lgan har kim API'dan oladi), shuning uchun
MCP ham xuddi shu chegarada ishlaydi. Kerak bo'lmasa `src/tools.ts` dagi
`Tannarx` va `Foyda` ustunlarini olib tashlang.

Parollar diskka yozilmaydi, faqat jarayon xotirasida turadi. Serverni faqat
o'zingiz nazorat qiladigan mashinada ishlating.

---

## 9. Claude Code / Desktop (stdio, ixtiyoriy)

Xohlasangiz stdio rejimi ham ishlaydi — hosting va OAuth kerak emas, lekin
har kim o'z kompyuterida o'rnatishi kerak:

```bash
claude mcp add ezgutech --scope user \
  --env XPERT_TRANSPORT=stdio \
  --env XPERT_API_URL=https://api.ezgutech.uz/api/v1 \
  --env XPERT_LOGIN=<login> \
  --env XPERT_PASSWORD=<parol> \
  -- node D:/loyiha/xpert-mcp/dist/index.js
```
"# ezgutech-mcp" 
