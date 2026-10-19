# Zak Financial

Sistem kewangan peribadi (bajet bulanan, rekod bayaran, simpanan, pinjaman). Static site (GitHub Pages) + Supabase.

## Keselamatan
- **Tiada data peribadi dalam repo ini.** Hanya kod + skema. Data hidup dalam Supabase.
- Login emel + kata laluan **dan** TOTP 2FA (wajib). RLS menolak semua query kecuali sesi `aal2` milik UID dalam `app_owner`.
- `anon` tiada akses ke mana-mana jadual (hanya `ping()` untuk keep-alive).
- Sesi disimpan dalam `sessionStorage`: tutup tab = log keluar. Auto log keluar selepas 15 minit tiada aktiviti.
- CSP ketat (`script-src 'self'`), supabase-js di-vendor (tiada CDN pihak ketiga), `noindex`.
- Semua perubahan direkod dalam `audit_log`.
- Supabase Auth: **public signup mesti OFF**.

## Struktur
- `index.html`, `styles.css`, `app.js` — app
- `config.js` — URL projek + publishable key (awam, selamat)
- `vendor/supabase.js` — @supabase/supabase-js 2.45.4 (UMD)
- `supabase/migrations/` — skema

## Backup
Tetapan → Eksport JSON (backup penuh) / CSV. Simpan di tempat selamat, bukan dalam repo ini.
