/**
 * pm2 konfiguratsiyasi.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup        # server qayta yuklanganda avtomatik ko'tarilishi uchun
 *
 * ⚠️ instances FAQAT 1 BO'LISHI KERAK, exec_mode esa 'fork'.
 *
 * Sabab: OAuth tokenlari, foydalanuvchi sessiyalari va MCP sessiyalari
 * jarayonning XOTIRASIDA saqlanadi. Cluster rejimida bir nechta ishchi
 * bo'ladi va har biri o'z xotirasiga ega — foydalanuvchi bitta ishchida
 * login qilib, keyingi so'rovi boshqasiga tushsa "token yaroqsiz" xatosi
 * chiqadi. Yuklama kam bo'lgani uchun (kuniga ~200 so'rov) bitta jarayon
 * yetib ortadi.
 */

module.exports = {
  apps: [
    {
      name: 'xpert-mcp',
      script: 'dist/index.js',
      cwd: __dirname,

      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',

      // Xotira sizib ketsa qayta ishga tushadi (odatda ~80 MB yetadi)
      max_memory_restart: '300M',

      // .env avtomatik o'qiladi (src/env.ts) — bu yerda takrorlash shart emas.
      // Muhitda berilgan qiymat .env dan ustun turadi.
      env: {
        NODE_ENV: 'production',
      },

      // Log'lar: stderr — server xabarlari, stdout — bo'sh
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      time: true,
    },
  ],
}
