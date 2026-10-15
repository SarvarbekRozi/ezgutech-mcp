/**
 * Connector login sahifasi — EZGUTECH tizimining login sahifasi bilan bir xil
 * ko'rinishda (`xpert-front/src/pages/login.vue`).
 *
 * Tuzilishi:
 *   - Yuqori chapda logotip + "EZGUTECH"
 *   - Desktopda ikki ustun: chapda illyustratsiya (8/12), o'ngda karta (4/12)
 *   - Telefonda chap ustun yashiriladi, faqat karta qoladi
 *   - Ranglar, shrift, maydon va tugma stillari Vuexy mavzusidan olingan
 *
 * Vue/Vuetify ishlatilmaydi — bu oddiy HTML, brauzerda hech qanday JS
 * yuklanmaydi (parol ko'rsatish tugmasidan boshqa).
 */

import { brand } from './branding.js'

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  )

const styles = `
  :root {
    color-scheme: light dark;
    --primary: ${brand.primary};
    --primary-darken: ${brand.primaryDarken};
    --error: ${brand.error};
    --bg: ${brand.light.background};
    --surface: ${brand.light.surface};
    --on-surface: ${brand.light.onSurface};
    --border: rgba(47, 43, 61, 22%);
    --mask: url("${brand.assets.maskLight}");
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: ${brand.dark.background};
      --surface: ${brand.dark.surface};
      --on-surface: ${brand.dark.onSurface};
      --border: rgba(225, 222, 245, 22%);
      --mask: url("${brand.assets.maskDark}");
    }
  }

  * { box-sizing: border-box; }

  html, body { block-size: 100%; }

  body {
    margin: 0;
    background: var(--surface);
    color: var(--on-surface);
    font-family: ${brand.fontFamily};
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Logotip (yuqori chapda, login.vue dagi .auth-logo kabi) ─────────────── */
  .auth-logo {
    position: absolute;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 12px;
    inset-block-start: 32px;
    inset-inline-start: 32px;
  }

  .auth-logo img { display: block; block-size: 34px; inline-size: auto; }

  .auth-title {
    margin: 0;
    color: var(--on-surface);
    font-size: 1.375rem;
    font-weight: 700;
    letter-spacing: 0.15px;
    text-transform: uppercase;
  }

  /* ── Ikki ustunli tuzilish ──────────────────────────────────────────────── */
  .auth-wrapper { display: flex; min-block-size: 100dvh; }

  .auth-left {
    position: relative;
    display: none;
    flex: 0 0 66.6667%;
    flex-direction: column;
    background: var(--bg);
  }

  .auth-illustration-wrap {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    padding-block: 96px 16px;
    padding-inline: 6.25rem;
  }

  /*
   * Illyustratsiya 1.25 MB. <img> bo'lsa brauzer uni TELEFONDA HAM yuklab
   * oladi — chap ustun display:none bo'lsa ham. CSS fon rasmi esa
   * yashirin elementda umuman so'ralmaydi, shuning uchun shunday qilingan.
   * aspect-ratio 613/509 — login.vue dagi max-width="613" bilan bir xil.
   */
  .auth-illustration { display: none; }

  @media (min-width: 960px) {
    .auth-illustration {
      display: block;
      aspect-ratio: 613 / 509;
      background-image: url("${brand.assets.illustration}");
      background-position: center;
      background-repeat: no-repeat;
      background-size: contain;
      inline-size: 100%;
      max-inline-size: 613px;
    }
  }

  .auth-footer-mask {
    position: absolute;
    z-index: 0;
    background-image: var(--mask);
    background-position: bottom;
    background-repeat: no-repeat;
    background-size: cover;
    block-size: 280px;
    inline-size: 100%;
    inset-block-end: 0;
    inset-inline-start: 0;
    pointer-events: none;
  }

  .auth-right {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--surface);
  }

  @media (min-width: 960px) {
    .auth-left { display: flex; }
    .auth-right { flex: 0 0 33.3333%; }
  }

  /* ── Karta ──────────────────────────────────────────────────────────────── */
  .auth-card { inline-size: 100%; max-inline-size: 420px; padding: 16px; }

  .auth-heading {
    margin: 0 0 4px;
    font-size: 1.5rem;
    font-weight: 500;
    line-height: 1.375;
  }

  .auth-sub {
    margin: 0 0 24px;
    color: rgb(from var(--on-surface) r g b / 70%);
    font-size: 0.9375rem;
  }

  /* ── Maydonlar (Vuexy AppTextField ko'rinishi) ──────────────────────────── */
  .field { margin-block-end: 20px; }

  .field label {
    display: block;
    margin-block-end: 6px;
    color: rgb(from var(--on-surface) r g b / 78%);
    font-size: 0.8125rem;
    font-weight: 400;
    line-height: 1.25;
  }

  .field-input-wrap { position: relative; display: flex; align-items: center; }

  .field input {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--on-surface);
    font-family: inherit;
    font-size: 0.9375rem;
    inline-size: 100%;
    min-block-size: 44px;
    padding-block: 8px;
    padding-inline: 14px 14px;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .field input::placeholder { color: rgb(from var(--on-surface) r g b / 42%); }

  .field input:hover { border-color: rgb(from var(--on-surface) r g b / 40%); }

  .field input:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px var(--primary);
    outline: none;
  }

  .field.has-toggle input { padding-inline-end: 44px; }

  .toggle-eye {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    block-size: 32px;
    color: rgb(from var(--on-surface) r g b / 55%);
    cursor: pointer;
    inline-size: 32px;
    inset-inline-end: 6px;
  }

  .toggle-eye:hover { background: rgb(from var(--on-surface) r g b / 6%); }
  .toggle-eye svg { block-size: 20px; inline-size: 20px; }

  /* ── Tugma (Vuexy VBtn ko'rinishi) ─────────────────────────────────────── */
  .btn-submit {
    border: 0;
    border-radius: 6px;
    background: var(--primary);
    box-shadow: 0 2px 4px 0 rgb(78 91 228 / 40%);
    color: #fff;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.9375rem;
    font-weight: 500;
    inline-size: 100%;
    letter-spacing: 0.43px;
    min-block-size: 42px;
    text-transform: capitalize;
    transition: background 0.15s ease, box-shadow 0.15s ease;
  }

  .btn-submit:hover { background: var(--primary-darken); box-shadow: 0 4px 8px 0 rgb(78 91 228 / 45%); }
  .btn-submit:active { transform: translateY(1px); }

  /* ── Xato ───────────────────────────────────────────────────────────────── */
  .alert-error {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-block-end: 20px;
    padding: 12px 14px;
    border-radius: 6px;
    background: rgb(255 76 81 / 12%);
    color: var(--error);
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .alert-error svg { flex: 0 0 auto; block-size: 18px; inline-size: 18px; margin-block-start: 1px; }

  /* ── Pastdagi izoh ──────────────────────────────────────────────────────── */
  .auth-note {
    margin: 24px 0 0;
    color: rgb(from var(--on-surface) r g b / 60%);
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  .auth-note strong { color: rgb(from var(--on-surface) r g b / 85%); font-weight: 600; }
`

const EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.585 10.587a2 2 0 0 0 2.829 2.828"/><path d="M16.681 16.673A8.717 8.717 0 0 1 12 18c-3.6 0-6.6-2-9-6 1.272-2.12 2.712-3.678 4.32-4.674m2.86-1.146A9.055 9.055 0 0 1 12 6c3.6 0 6.6 2 9 6-.666 1.11-1.379 2.067-2.138 2.87"/><path d="M3 3l18 18"/></svg>`
const EYE_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M22 12c-2.667 4.667-6 7-10 7s-7.333-2.333-10-7c2.667-4.667 6-7 10-7s7.333 2.333 10 7"/></svg>`

const ALERT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>`

/**
 * @param authId `/authorize` bergan so'rov identifikatori (formada yashirin maydon)
 * @param error  EzguTech qaytargan xato — forma qayta ko'rsatilganda
 */
export const loginPage = (authId: string, error?: string): string => `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${brand.title} — Claude connector uchun kirish</title>
<link rel="icon" href="${brand.assets.logo}">
<style>${styles}</style>
</head>
<body>
  <div class="auth-logo">
    <img src="${brand.assets.logo}" alt="${brand.title}">
    <h1 class="auth-title">${brand.title}</h1>
  </div>

  <div class="auth-wrapper">
    <div class="auth-left">
      <div class="auth-illustration-wrap">
        <div class="auth-illustration" aria-hidden="true"></div>
      </div>
      <div class="auth-footer-mask"></div>
    </div>

    <div class="auth-right">
      <form class="auth-card" method="post" action="/xpert-login" autocomplete="on">
        <h2 class="auth-heading">${brand.copy.heading}!</h2>
        <p class="auth-sub">${brand.copy.subheading}</p>

        ${
          error
            ? `<div class="alert-error" role="alert">${ALERT_ICON}<span>${escapeHtml(error)}</span></div>`
            : ''
        }

        <input type="hidden" name="auth_id" value="${escapeHtml(authId)}">

        <div class="field">
          <label for="login">${brand.copy.loginLabel}</label>
          <div class="field-input-wrap">
            <input id="login" name="login" type="text" inputmode="email"
                   placeholder="${brand.copy.loginPlaceholder}"
                   autocomplete="username" required autofocus>
          </div>
        </div>

        <div class="field has-toggle">
          <label for="password">${brand.copy.passwordLabel}</label>
          <div class="field-input-wrap">
            <input id="password" name="password" type="password"
                   placeholder="${brand.copy.passwordPlaceholder}"
                   autocomplete="current-password" required>
            <button type="button" class="toggle-eye" id="toggle"
                    aria-label="Parolni ko'rsatish">${EYE_OFF}</button>
          </div>
        </div>

        <button type="submit" class="btn-submit">${brand.copy.submit}</button>

        <p class="auth-note">
          Claude sizning ruxsatlaringiz doirasidagi ma'lumotlarni faqat
          <strong>o'qiy</strong> oladi — hech narsani o'zgartira, qo'sha yoki
          o'chira olmaydi.
        </p>
      </form>
    </div>
  </div>

<script>
  (function () {
    var input = document.getElementById('password')
    var button = document.getElementById('toggle')
    var eyeOff = ${JSON.stringify(EYE_OFF)}
    var eyeOn = ${JSON.stringify(EYE_ON)}

    button.addEventListener('click', function () {
      var shown = input.type === 'text'

      input.type = shown ? 'password' : 'text'
      button.innerHTML = shown ? eyeOff : eyeOn
      button.setAttribute('aria-label', shown ? "Parolni ko'rsatish" : 'Parolni yashirish')
      input.focus()
    })
  })()
</script>
</body>
</html>`
