/**
 * EZGUTECH brend qiymatlari.
 *
 * Bu yerdagi ranglar, shrift va matnlar xpert-front dan bir xilga olingan
 * (`themeConfig.js`, `src/plugins/vuetify/theme.js`, `src/pages/login.vue`) —
 * connector login sahifasi tizimning o'zidan farq qilmasligi uchun.
 *
 * Rasmlar `public/brand/` dan statik beriladi (illyustratsiya 1.25 MB —
 * uni HTML ichiga joylash ma'nosiz).
 */

export const brand = {
  title: 'EZGUTECH',

  // ── Ranglar: xpert-front/src/plugins/vuetify/theme.js ──────────────────────
  primary: '#4E5BE4',
  primaryDarken: '#4550CD',
  secondary: '#808390',
  error: '#FF4C51',

  light: {
    background: '#F8F7FA',
    surface: '#FFFFFF',
    onSurface: '#2F2B3D',
  },

  dark: {
    background: '#25293C',
    surface: '#2F3349',
    onSurface: '#E1DEF5',
  },

  // ── Shrift: xpert-front/src/@core/scss/template/libs/vuetify/_variables.scss
  fontFamily:
    '"Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',

  // ── Statik fayllar (public/brand/) ─────────────────────────────────────────
  assets: {
    logo: '/brand/logo.svg',
    illustration: '/brand/auth-login-image.png',
    maskLight: '/brand/misc-mask-light.png',
    maskDark: '/brand/misc-mask-dark.png',
  },

  // ── Matnlar: xpert-front/src/pages/login.vue ───────────────────────────────
  copy: {
    heading: 'EZGUTECH CRM ga xush kelibsiz',
    subheading: 'Iltimos akkountingizga kirish uchun login va parolni kiriting',
    loginLabel: 'Login',
    loginPlaceholder: 'Loginingiz',
    passwordLabel: 'Parol',
    passwordPlaceholder: '············',
    submit: 'Kirish',
  },
} as const
