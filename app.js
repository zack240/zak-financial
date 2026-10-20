'use strict';
(function () {
  const C = window.ZF_CONFIG || {};
  const sb = window.supabase.createClient(C.url, C.key, {
    // sessionStorage: tutup tab = log keluar. Tiada sesi kekal dalam browser.
    auth: { persistSession: true, storage: window.sessionStorage, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const IDLE_MS = 15 * 60 * 1000;
  const BUCKETS = { komitmen: 'Komitmen', invest: 'Invest', reward: 'Self Reward' };
  const KINDS = { kecemasan: 'Dana kecemasan', pelaburan: 'Pelaburan', matlamat: 'Matlamat belanja' }; // jenis dalam bucket invest
  const STATUS = [
    { k: 'done', sym: '✓', label: 'Dah bayar' },
    { k: 'skip', sym: '0', label: 'Tak bayar bulan ni' },
    { k: 'missed', sym: 'X', label: 'Terlepas' },
    { k: 'company', sym: 'Co', label: 'Company bayar' },
  ];
  const MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Number(v || 0);
  const rm = (n) => 'RM' + num(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const amt = (n, cls = '') => `<span class="amt ${cls}">${rm(n)}</span>`;
  const monthLabel = (iso) => { const d = new Date(iso + 'T00:00:00'); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const shortMonth = (iso) => { const d = new Date(iso + 'T00:00:00'); return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; };
  const fmtDate = (iso) => { if (!iso) return '—'; const d = new Date(iso + 'T00:00:00'); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const round2 = (n) => Math.round(n * 100) / 100;
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const monthsBetween = (a, b) => { const x = new Date(a + 'T00:00:00'), y = new Date(b + 'T00:00:00'); return (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth(); };

  const S = {
    settings: {}, accounts: [], items: [], periods: [], entries: [], transfers: [], loans: [], payments: [], payslips: [],
    view: 'ringkasan', periodId: null, matrix: true, // Rekod buka dalam Jadual penuh
  };

  // ---------- toast ----------
  let toastT;
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, bad ? 5000 : 2200);
  }
  async function q(promise) {
    const { data, error } = await promise;
    if (error) { toast(error.message, true); throw error; }
    return data;
  }

  // ================= AUTH =================
  let mfaState = null; // { factorId, enrolling }

  function showAuth() { $('#app').hidden = true; $('#auth').hidden = false; }
  function showLogin() { showAuth(); $('#loginForm').hidden = false; $('#mfaForm').hidden = true; }

  async function route() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showLogin();
    const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return showLogin();
    if (aal.currentLevel === 'aal2') return startApp();
    return startMfa();
  }

  async function startMfa() {
    showAuth();
    $('#loginForm').hidden = true; $('#mfaForm').hidden = false; $('#mfaErr').textContent = ''; $('#mfaCode').value = '';
    const { data, error } = await sb.auth.mfa.listFactors();
    if (error) { $('#mfaErr').textContent = error.message; return; }
    const verified = (data.totp || []).find((f) => f.status === 'verified');
    if (verified) {
      mfaState = { factorId: verified.id, enrolling: false };
      $('#mfaTitle').textContent = 'Pengesahan 2 langkah'; $('#mfaEnroll').hidden = true;
    } else {
      // buang faktor tak siap dari cubaan lama
      for (const f of data.all || []) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data: en, error: e2 } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Zak Financial ' + Date.now() });
      if (e2) { $('#mfaErr').textContent = e2.message; return; }
      mfaState = { factorId: en.id, enrolling: true };
      $('#mfaTitle').textContent = 'Aktifkan pengesahan 2 langkah';
      $('#mfaQr').src = en.totp.qr_code; $('#mfaSecret').textContent = en.totp.secret; $('#mfaEnroll').hidden = false;
    }
    $('#mfaCode').focus();
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#loginErr').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: $('#loginEmail').value.trim(), password: $('#loginPass').value });
    $('#loginPass').value = '';
    if (error) { $('#loginErr').textContent = 'Log masuk gagal.'; return; }
    route();
  });

  $('#mfaForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#mfaErr').textContent = '';
    const code = $('#mfaCode').value.trim();
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: mfaState.factorId, code });
    if (error) { $('#mfaErr').textContent = 'Kod salah atau tamat tempoh.'; return; }
    $('#mfaQr').removeAttribute('src'); $('#mfaSecret').textContent = '';
    route();
  });

  $('#mfaCancel').addEventListener('click', logout);
  $('#logoutBtn').addEventListener('click', logout);
  async function logout() {
    await sb.auth.signOut();
    Object.assign(S, { settings: {}, accounts: [], items: [], periods: [], entries: [], transfers: [], loans: [], payments: [], payslips: [] });
    $('#view').innerHTML = '';
    showLogin();
  }

  // idle logout
  let idleT;
  function bumpIdle() { clearTimeout(idleT); idleT = setTimeout(() => { if (!$('#app').hidden) { logout(); toast('Log keluar automatik (tiada aktiviti 15 minit).'); } }, IDLE_MS); }
  ['click', 'keydown', 'touchstart', 'scroll'].forEach((ev) => window.addEventListener(ev, bumpIdle, { passive: true }));

  // privacy blur (diingati per peranti)
  function setPrivate(on) {
    document.body.classList.toggle('private', on);
    $('#privacyBtn').textContent = on ? 'Tunjuk RM' : 'Sorok RM';
    try { localStorage.setItem('zf-private', on ? '1' : '0'); } catch (_) {}
  }
  $('#privacyBtn').addEventListener('click', () => setPrivate(!document.body.classList.contains('private')));
  try { setPrivate(localStorage.getItem('zf-private') === '1'); } catch (_) { setPrivate(false); }

  // ================= DATA =================
  async function loadAll() {
    const [settings, accounts, items, periods, entries, transfers, loans, payments, payslips] = await Promise.all([
      q(sb.from('settings').select('*')),
      q(sb.from('accounts').select('*').order('sort')),
      q(sb.from('items').select('*').order('sort')),
      q(sb.from('periods').select('*').order('month', { ascending: false })),
      q(sb.from('entries').select('*')),
      q(sb.from('transfers').select('*').order('created_at')),
      q(sb.from('loans').select('*').order('created_at')),
      q(sb.from('loan_payments').select('*').order('paid_on', { ascending: false })),
      q(sb.from('payslips').select('*').order('month', { ascending: false })),
    ]);
    periods.sort((a, b) => b.month.localeCompare(a.month));
    payslips.sort((a, b) => b.month.localeCompare(a.month));
    accounts.sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
    items.sort(itemOrder);
    S.settings = Object.fromEntries(settings.map((r) => [r.key, r.value]));
    Object.assign(S, { accounts, items, periods, entries, transfers, loans, payments, payslips });
    if (!S.periodId || !periods.find((p) => p.id === S.periodId)) S.periodId = periods[0]?.id || null;
  }

  const income = () => num(S.settings.income ?? 0);
  const split = () => S.settings.split || { komitmen: 60, invest: 20, reward: 20 };
  const acct = (id) => S.accounts.find((a) => a.id === id);
  const slipOf = (month) => S.payslips.find((s) => s.month === month);
  const activeSelfItems = () => S.items.filter((i) => i.active && i.paid_by === 'self');

  async function startApp() {
    if (document.activeElement) document.activeElement.blur();
    $('#auth').hidden = true; $('#app').hidden = false; bumpIdle();
    $('#view').innerHTML = '<p class="muted">Memuatkan…</p>';
    try { await loadAll(); } catch (e) { $('#view').innerHTML = `<div class="alert bad">Gagal muat data: ${esc(e.message)}</div>`; return; }
    render();
  }

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]'); if (!b) return;
    S.view = b.dataset.view; $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); render();
  });

  function render() {
    const v = $('#view');
    ({ ringkasan: renderSummary, rekod: renderRecord, item: renderItems, pinjaman: renderLoans, gaji: renderPayslips, tetapan: renderSettings })[S.view](v);
  }

  // ================= RINGKASAN =================
  function renderSummary(v) {
    const inc = income();
    const items = activeSelfItems();
    const total = round2(items.reduce((s, i) => s + num(i.amount), 0));
    const diff = round2(inc - total);
    const sp = split();
    const saved = S.periods.reduce((s, p) => s + num(p.leftover), 0);
    const closed = S.periods.filter((p) => p.leftover !== null);
    const avgSaved = closed.length ? saved / closed.length : 0;

    // disiplin = done / (done+missed) 6 bulan terakhir
    const recent = S.periods.slice(0, 6).map((p) => p.id);
    const re = S.entries.filter((e) => recent.includes(e.period_id));
    const dDone = re.filter((e) => e.status === 'done').length;
    const dMiss = re.filter((e) => e.status === 'missed').length;
    const disc = dDone + dMiss ? Math.round((dDone / (dDone + dMiss)) * 100) : null;

    // arah "baik" setiap bucket: komitmen & reward elok bawah sasaran, invest elok atas sasaran
    const GOOD_DIR = { komitmen: 'under', invest: 'over', reward: 'under' };
    const byBucket = Object.keys(BUCKETS).map((k) => {
      const actual = round2(items.filter((i) => i.bucket === k).reduce((s, i) => s + num(i.amount), 0));
      const target = round2(inc * num(sp[k]) / 100);
      const gap = round2(actual - target);
      const bad = GOOD_DIR[k] === 'under' ? gap > 0 : gap < 0;
      const tone = !bad ? 'good' : Math.abs(gap) > target * 0.05 ? 'bad' : 'warn';
      const msg = k === 'komitmen' ? (gap > 0 ? `Lebih ${amt(gap)} dari sasaran` : `Bawah sasaran ${amt(-gap)}, bagus`)
        : k === 'invest' ? (gap >= 0 ? `Lebih ${amt(gap)} dari sasaran, bagus` : `Kurang ${amt(-gap)} dari sasaran`)
        : (gap > 0 ? `Lebih ${amt(gap)} dari had` : `Belanja ${amt(-gap)} bawah had, tak perlu dihabiskan`);
      return { k, actual, target, pct: num(sp[k]), real: inc ? round2(actual / inc * 100) : 0, tone, bad, msg };
    });

    const accts = S.accounts.filter((a) => a.active).map((a) => {
      const its = items.filter((i) => i.account_id === a.id);
      return { a, its, total: round2(its.reduce((s, i) => s + num(i.amount), 0)) };
    }).filter((x) => x.its.length || x.a.balance_cap);
    const company = S.items.filter((i) => i.active && i.paid_by === 'company');
    const noAcct = items.filter((i) => !i.account_id);

    v.innerHTML = `
      ${diff < 0 ? `<div class="alert bad"><b>Peruntukan melebihi gaji sebanyak ${amt(-diff)}.</b> Jumlah item aktif ${amt(total)} berbanding pendapatan ${amt(inc)}. Kurangkan item atau ambil dari baki bulan lepas.</div>` : ''}
      <div class="grid g4">
        <div class="card kpi"><div class="lbl">Pendapatan bulanan</div><div class="val">${amt(inc)}</div><div class="sub">Gaji masuk ${esc(S.accounts.find((a) => /gaji/i.test(a.role || ''))?.code || '')}</div></div>
        <div class="card kpi"><div class="lbl">Jumlah peruntukan</div><div class="val">${amt(total)}</div><div class="sub">${items.length} item aktif</div></div>
        <div class="card kpi"><div class="lbl">${diff < 0 ? 'Defisit' : 'Lebihan'} bulanan</div><div class="val ${diff < 0 ? 'bad' : 'good'}">${amt(diff)}</div><div class="sub">Pendapatan − peruntukan</div></div>
        <div class="card kpi"><div class="lbl">Simpanan terkumpul</div><div class="val">${amt(saved)}</div><div class="sub">Purata ${amt(avgSaved)} / bulan · ${closed.length} bulan</div></div>
      </div>

      <div class="grid g2">
        <div class="card">
          <div class="card-h"><h2>Peraturan ${byBucket.map((b) => b.pct).join('/')}</h2><span class="muted small">Sasaran vs sebenar</span></div>
          ${byBucket.map((b) => {
            const w = b.target ? Math.min(100, (b.actual / b.target) * 100) : 0;
            return `<div class="bucket">
              <div class="row"><b class="grow">${BUCKETS[b.k]} <span class="muted small">sasaran ${b.pct}% · sebenar ${b.real}%</span></b>
                <span class="${b.bad ? b.tone : ''}">${amt(b.actual)}</span><span class="muted small">/ ${amt(b.target)}</span></div>
              <div class="bar"><i class="${b.bad ? (b.tone === 'bad' ? 'over' : 'warn') : ''}" data-w="${w}"></i></div>
              <div class="small ${b.tone === 'good' ? 'good' : b.tone}">${b.msg}</div>
              ${b.k === 'invest' ? `<div class="small muted">${kindSplit(items).map(([l, n]) => `${l} ${rm(n)}`).join(' · ')}</div>` : ''}
            </div>`;
          }).join('')}
          ${diff > 0 ? `<div class="bucket">
              <div class="row"><b class="grow">Belum diagih <span class="muted small">${inc ? round2(diff / inc * 100) : 0}%</span></b><span class="${diff < 20 ? 'good' : 'warn'}">${amt(diff)}</span></div>
              <div class="small ${diff < 20 ? 'good' : 'muted'}">${diff < 20 ? 'Seimbang, hampir setiap ringgit dah ada tugas.' : 'Duit tanpa tugas biasanya habis dalam belanja harian. Lihat cadangan di bawah.'}</div>
            </div>` : ''}
        </div>
        <div class="card">
          <div class="card-h"><h2>Simpanan bulanan</h2><span class="muted small">Baki ("ALL BALANCE") setiap bulan</span></div>
          ${savingsChart()}
          <div class="row small muted" style="margin-top:8px">
            <span>Disiplin bayaran 6 bulan: <b class="${disc !== null && disc < 95 ? 'warn' : 'good'}">${disc === null ? '—' : disc + '%'}</b></span>
            <span>· Bulan simpanan RM0: <b>${closed.filter((p) => num(p.leftover) === 0).length}</b></span>
          </div>
        </div>
      </div>

      ${adviceCard(inc, items, byBucket, diff)}

      <div class="card">
        <div class="card-h"><h2>Pindahan hari gaji</h2><span class="muted small">Berapa nak masuk ke setiap akaun bila gaji masuk</span></div>
        <div class="grid g4">
          ${accts.map(({ a, its, total }) => `
            <div class="card acct" style="--acct:${esc(a.color)}">
              <div class="row"><b class="grow">${esc(a.code)}</b><span class="muted small">${esc(a.role || '')}</span></div>
              <div class="total">${amt(total)}</div>
              ${a.balance_cap ? `<div class="small warn">Had simpanan ${amt(a.balance_cap)} — ${esc(a.cap_note || '')}</div>` : ''}
              <ul>${its.map((i) => `<li><span>${esc(i.name)}</span>${amt(i.amount)}</li>`).join('')}</ul>
            </div>`).join('')}
        </div>
        ${noAcct.length ? `<p class="warn small">Item tanpa akaun: ${noAcct.map((i) => esc(i.name)).join(', ')}</p>` : ''}
        ${company.length ? `<p class="muted small" style="margin-top:12px">Dibayar company (tak dikira): ${company.map((i) => `${esc(i.name)} ${amt(i.amount)}`).join(', ')}</p>` : ''}
      </div>`;
    $$('.bar > i', v).forEach((i) => { i.style.width = i.dataset.w + '%'; });
    $$('[data-advice-item]', v).forEach((b) => (b.onclick = () => itemDialog(null, JSON.parse(b.dataset.adviceItem))));
  }

  // pecahan bucket invest ikut jenis: [[label, jumlah]]
  function kindSplit(items) {
    const inv = items.filter((i) => i.bucket === 'invest');
    const out = Object.entries(KINDS).map(([k, l]) => [l, round2(inv.filter((i) => i.kind === k).reduce((s, i) => s + num(i.amount), 0))]);
    const none = round2(inv.filter((i) => !KINDS[i.kind]).reduce((s, i) => s + num(i.amount), 0));
    if (none) out.push(['Belum ditanda', none]);
    return out.filter(([, n]) => n);
  }

  // ---------- cadangan penganalisis (peraturan, dari data sebenar) ----------
  const PHONE_RE = /celcom|maxis|digi|umobile|u mobile|unifi mobile|yes\b|hotlink|telefon|phone bill/i;
  const SUBS_RE = /spotify|netflix|icloud|njoi|astro|youtube|disney|viu|apple music|google one|prime/i;
  const EF_RE = /kecemasan|emergency/i;

  function adviceCard(inc, items, byBucket, diff) {
    if (!inc) return '';
    const pctOf = (n) => round2(num(n) / inc * 100);
    const K = byBucket.find((b) => b.k === 'komitmen'), I = byBucket.find((b) => b.k === 'invest'), R = byBucket.find((b) => b.k === 'reward');
    const companyNeeds = S.items.filter((i) => i.active && i.paid_by === 'company' && i.bucket === 'komitmen').reduce((s, i) => s + num(i.amount), 0);
    const needs = round2(K.actual + companyNeeds); // keperluan sebenar termasuk yg dipotong dari gaji (cth staff house)
    const efTarget = Math.ceil((needs * 3) / 100) * 100;
    const ef = items.find((i) => i.kind === 'kecemasan' || EF_RE.test(i.name));
    const recs = []; // { tone, title, body, action }
    const suggestEf = diff > 0 ? Math.max(50, Math.floor(diff / 10) * 10) : 100;

    if (!ef) recs.push({ tone: 'bad', title: 'Tiada dana kecemasan',
      body: `Keutamaan nombor satu. Sasaran 3 bulan keperluan ≈ <b>${rm(efTarget)}</b> (keperluan ${rm(needs)}/bulan termasuk rumah). Dengan ${rm(suggestEf)}/bulan, siap dalam ~${Math.ceil(efTarget / suggestEf)} bulan. Simpan di akaun berasingan yang tiada kad debit.`,
      action: { label: `Cipta item Dana kecemasan ${rm(suggestEf)}`, item: { name: 'Dana kecemasan', amount: suggestEf, bucket: 'invest', kind: 'kecemasan', notes: `Sasaran ${rm(efTarget)} (3 bulan keperluan)` } } });
    else recs.push({ tone: 'good', title: `Dana kecemasan ${rm(ef.amount)}/bulan`,
      body: `Sasaran ${rm(efTarget)} siap dalam ~${num(ef.amount) ? Math.ceil(efTarget / num(ef.amount)) : '∞'} bulan dari kosong. Lepas capai, alihkan caruman ini ke pelaburan jangka panjang.` });

    if (diff >= 20) recs.push({ tone: 'warn', title: `${rm(diff)} belum diagih (${pctOf(diff)}%)`,
      body: ef ? 'Beri setiap ringgit tugas: tambah ke dana kecemasan atau pelaburan, supaya tak bocor ke belanja harian.' : `Cadangan: ${rm(suggestEf)} ke dana kecemasan${diff - suggestEf > 0 ? `, baki ${rm(round2(diff - suggestEf))} sebagai penampan` : ''}.` });

    const jpa = S.loans.filter((l) => l.active && !num(l.monthly));
    for (const l of jpa) recs.push({ tone: 'warn', title: `${esc(l.name)}: bayaran belum diketahui`,
      body: `Bila bayaran ${esc(l.name)} bermula, komitmen akan naik melebihi ${K.pct}%. Kalau ada "belum diagih", jangan biasakan diri belanja duit tu. Ia akan diperlukan untuk ansuran ini.` });

    const phone = items.filter((i) => i.bucket === 'komitmen' && PHONE_RE.test(i.name) && num(i.amount) > 100 && !i.end_date);
    for (const p of phone) recs.push({ tone: 'warn', title: `${esc(p.name)} ${rm(p.amount)} (${pctOf(p.amount)}% gaji)`,
      body: `Plan telefon biasa RM40–100. Kalau ${rm(p.amount)} termasuk ansuran fon, catat tarikh tamat dalam nota item. Kalau tak, turun plan boleh jimat ~${rm(num(p.amount) - 100)}/bulan = ${rm((num(p.amount) - 100) * 12)} setahun.` });

    // item bertempoh: amaran bila hampir/dah tamat, ringkasan baki komitmen
    const termed = items.filter((i) => i.end_date).sort((a, b) => a.end_date.localeCompare(b.end_date));
    for (const t of termed) {
      const left = monthsLeft(t.end_date);
      if (left < 0) recs.push({ tone: 'bad', title: `${esc(t.name)} dah tamat ${fmtDate(t.end_date)}`, body: 'Kemas kini amaun (cth plan tanpa ansuran) atau nyahaktif item ini.' });
      else if (left <= 3) recs.push({ tone: 'warn', title: `${esc(t.name)} tamat ${fmtDate(t.end_date)} (${left} bulan lagi)`, body: `Bersedia: semak plan baharu yang lebih murah, jangan auto-sambung kontrak. ${rm(t.amount)}/bulan boleh dialih ke simpanan.` });
    }
    if (termed.length) recs.push({ tone: 'muted', title: `Komitmen bertempoh: ${rm(round2(termed.reduce((s, t) => s + num(t.amount) * Math.max(0, monthsLeft(t.end_date)), 0)))} lagi`,
      body: termed.map((t) => `${esc(t.name)} ${rm(t.amount)} × ${Math.max(0, monthsLeft(t.end_date))} bulan (tamat ${fmtDate(t.end_date)})`).join('<br>') + '<br>Bila tamat, alihkan amaun tu ke simpanan, jangan biar ia jadi belanja.' });

    const subs = items.filter((i) => SUBS_RE.test(i.name));
    const subsTot = round2(subs.reduce((s, i) => s + num(i.amount), 0));
    if (subs.length >= 2) recs.push({ tone: 'muted', title: `Langganan ${rm(subsTot)}/bulan = ${rm(subsTot * 12)} setahun`,
      body: `${subs.map((i) => esc(i.name)).join(', ')}. Semak yang jarang guna, atau kongsi plan keluarga.` });

    if (!R.bad && R.actual < R.target) recs.push({ tone: 'good', title: `Self reward ${R.real}% (had ${R.pct}%)`,
      body: `Bagus. Had ${R.pct}% ialah siling, bukan sasaran. Baki ruang ${rm(round2(R.target - R.actual))} lebih berguna jadi simpanan.` });
    if (I.actual >= I.target) recs.push({ tone: 'good', title: `Simpanan & invest ${I.real}% (sasaran ${I.pct}%)`,
      body: `Atas sasaran. ${kindSplit(items).map(([l, n]) => `${l} ${rm(n)} (${pctOf(n)}%)`).join(', ')}. Matlamat belanja perlu ada sasaran amaun dan tarikh. Hanya pelaburan yang membina kekayaan jangka panjang.` });
    if (K.bad) recs.push({ tone: K.tone, title: `Komitmen ${K.real}% (sasaran ${K.pct}%)`,
      body: `Item terbesar: ${items.filter((i) => i.bucket === 'komitmen').sort((a, b) => num(b.amount) - num(a.amount)).slice(0, 3).map((i) => `${esc(i.name)} ${pctOf(i.amount)}%`).join(', ')}.${companyNeeds ? ` Rumah ${rm(companyNeeds)} dipotong dari gaji, jadi keperluan sebenar ${pctOf(needs)}% dari gaji bersih.` : ''}` });

    // unjuran selepas ikut cadangan dana kecemasan
    const after = !ef && diff > 0 ? { k: K.real, i: pctOf(I.actual + suggestEf), r: R.real, u: pctOf(diff - suggestEf) } : null;
    return `<div class="card"><div class="card-h"><h2>Cadangan penganalisis</h2><span class="muted small">Ikut gaji bersih ${rm(inc)}</span></div>
      <div class="advice">${recs.map((r) => `<div class="adv ${r.tone}"><b>${r.title}</b><div class="small">${r.body}</div>
        ${r.action ? `<button class="btn sm primary" data-advice-item='${esc(JSON.stringify(r.action.item))}'>${r.action.label}</button>` : ''}</div>`).join('')}</div>
      ${after ? `<p class="small muted" style="margin-top:12px">Selepas cadangan: Komitmen ${after.k}% · Simpanan &amp; invest ${after.i}% · Self reward ${after.r}% · Belum diagih ${after.u}%. Lebih baik dari 60/20/20 sebab simpanan lebih tinggi.</p>` : ''}
    </div>`;
  }

  function savingsChart() {
    const ps = S.periods.slice(0, 14).reverse();
    if (!ps.length) return '<p class="muted">Tiada data.</p>';
    const W = 560, H = 180, pad = 24, bw = (W - pad) / ps.length;
    const max = Math.max(100, ...ps.map((p) => num(p.leftover)));
    const bars = ps.map((p, i) => {
      const val = num(p.leftover); const h = Math.max(2, (val / max) * (H - 50));
      const x = pad + i * bw + bw * 0.15, y = H - 22 - h;
      return `<rect class="b ${val ? '' : 'zero'}" x="${x}" y="${y}" width="${bw * 0.7}" height="${h}" rx="3"><title>${monthLabel(p.month)}: ${rm(val)}</title></rect>
        <text x="${x + bw * 0.35}" y="${H - 6}" text-anchor="middle">${MONTHS[new Date(p.month + 'T00:00:00').getMonth()]}</text>
        <text class="amt" x="${x + bw * 0.35}" y="${y - 4}" text-anchor="middle">${val ? Math.round(val) : ''}</text>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Simpanan bulanan"><line class="axis" x1="${pad}" x2="${W}" y1="${H - 22}" y2="${H - 22}"/>${bars}</svg>`;
  }

  // ================= REKOD =================
  // Bulan seterusnya yang dah bermula tapi belum dibuka -> { month, payday, daysTo }
  function nextDraft() {
    if (!S.periods.length) return null;
    const month = nextMonthIso();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(month + 'T00:00:00');
    if (today < start) return null;
    // hari gaji dijangka = median hari gaji 3 bulan terakhir
    const days = S.periods.slice(0, 3).map((p) => p.payday && new Date(p.payday + 'T00:00:00').getDate()).filter(Boolean).sort((a, b) => a - b);
    const dim = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    const day = Math.min(dim, days.length ? days[Math.floor(days.length / 2)] : 25);
    const pay = new Date(start.getFullYear(), start.getMonth(), day);
    const payday = `${pay.getFullYear()}-${String(pay.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { month, payday, daysTo: Math.round((pay - today) / 86400000) };
  }

  function renderRecord(v) {
    const p = S.periods.find((x) => x.id === S.periodId);
    const dr = nextDraft();
    v.innerHTML = `
      ${dr ? `<div class="alert ${dr.daysTo < 0 ? 'bad' : 'warn'} row draft-alert"><span class="grow"><b>${monthLabel(dr.month)} belum direkod.</b>
        Gaji dijangka ~${fmtDate(dr.payday)} ${dr.daysTo > 0 ? `(${dr.daysTo} hari lagi)` : dr.daysTo === 0 ? '(hari ini)' : `(dah lepas ${-dr.daysTo} hari)`}.</span>
        <button class="btn primary sm" data-open-draft>＋ Buka ${monthLabel(dr.month)}</button></div>` : ''}
      <div class="card">
        <div class="row">
          <select id="periodSel" class="grow" aria-label="Pilih bulan">${S.periods.map((x) => `<option value="${x.id}" ${x.id === S.periodId ? 'selected' : ''}>${monthLabel(x.month)}</option>`).join('')}</select>
          <button class="btn primary" id="newPeriod">＋ Bulan baru</button>
          <button class="btn ghost" id="toggleMatrix">${S.matrix ? 'Senarai semak' : 'Jadual penuh'}</button>
        </div>
      </div>
      <div id="recBody"></div>`;
    $('#periodSel').onchange = (e) => { S.periodId = e.target.value; renderRecord(v); };
    $('#newPeriod').onclick = () => newPeriodDialog(dr);
    $('#toggleMatrix').onclick = () => { S.matrix = !S.matrix; renderRecord(v); };
    const body = $('#recBody');
    const bindDraft = () => $$('[data-open-draft]', v).forEach((b) => (b.onclick = () => newPeriodDialog(dr)));
    if (S.matrix) { renderMatrix(body, dr); return bindDraft(); }
    bindDraft();
    if (!p) { body.innerHTML = '<div class="card muted">Belum ada bulan. Tekan "＋ Bulan baru".</div>'; return; }

    const ents = S.entries.filter((e) => e.period_id === p.id);
    const entOf = (iid) => ents.find((e) => e.item_id === iid);
    // item yg aktif + item yg ada rekod bulan ni
    const its = S.items.filter((i) => i.active || entOf(i.id));
    const doneCount = its.filter((i) => ['done', 'company'].includes(entOf(i.id)?.status)).length;
    const paid = its.reduce((s, i) => { const e = entOf(i.id); return e?.status === 'done' ? s + num(e.amount ?? i.amount) : s; }, 0);
    const trs = S.transfers.filter((t) => t.period_id === p.id);

    const groups = [...S.accounts.map((a) => ({ a, list: its.filter((i) => i.account_id === a.id) })), { a: null, list: its.filter((i) => !i.account_id) }].filter((g) => g.list.length);

    body.innerHTML = `
      <div class="grid g4">
        <div class="card kpi"><div class="lbl">Hari gaji</div><div class="val">${fmtDate(p.payday)}</div></div>
        <div class="card kpi"><div class="lbl">Pendapatan</div><div class="val">${amt(p.income)}</div>${slipOf(p.month) ? `<div class="sub">Bersih · kasar ${rm(slipOf(p.month).gross)}</div>` : ''}</div>
        <div class="card kpi"><div class="lbl">Selesai</div><div class="val">${doneCount}/${its.length}</div><div class="sub">${amt(paid)} dibayar</div></div>
        <div class="card kpi"><div class="lbl">Baki / Saving</div><div class="val">${p.leftover === null ? '—' : amt(p.leftover)}</div><div class="sub">${p.closed ? 'Bulan ditutup' : 'Masih terbuka'}</div></div>
      </div>
      <div class="card">
        <div class="card-h"><h2>${monthLabel(p.month)}</h2><button class="btn sm" id="editPeriod">Edit bulan</button></div>
        ${p.notes ? `<p class="muted small">${esc(p.notes)}</p>` : ''}
      </div>
        ${groups.map(({ a, list }) => `
          <div class="card seg" style="--acct:${esc(a?.color || '#999999')}">
            <h3><span><span class="dot"></span>${esc(a ? `${a.code} · ${a.role || ''}` : 'Tiada akaun')}</span>
              <span class="muted small">${amt(list.filter((i) => i.paid_by === 'self').reduce((s, i) => s + num(i.amount), 0))}</span></h3>
            ${list.map((i) => {
              const e = entOf(i.id); const st = e?.status || 'pending';
              return `<div class="citem">
                <div><div class="nm">${esc(i.name)}${i.active ? '' : ' <span class="muted small">(tak aktif)</span>'}</div>
                  <div class="meta">${amt(e?.amount ?? i.amount)}${e?.amount != null && num(e.amount) !== num(i.amount) ? ` <span class="small">(asal ${rm(i.amount)})</span>` : ''}${e?.note ? ' · ' + esc(e.note) : ''}</div></div>
                <div class="chips">
                  ${STATUS.map((s) => `<button class="chip ${s.k} ${st === s.k ? 'on' : ''}" data-item="${i.id}" data-st="${s.k}" title="${s.label}">${s.sym}</button>`).join('')}
                  <button class="chip ${st === 'other' ? 'on other' : ''}" data-item="${i.id}" data-note="1" title="Nota / amaun lain">⋯</button>
                </div>
              </div>`;
            }).join('')}
          </div>`).join('')}
      <div class="card">
        <div class="card-h"><h2>Pindahan gabung</h2><button class="btn sm" id="addTransfer">＋ Tambah</button></div>
        ${trs.length ? `<div class="tbl-wrap"><table><thead><tr><th>Akaun</th><th>Untuk</th><th class="r">Amaun</th><th></th></tr></thead><tbody>
          ${trs.map((t) => `<tr><td><span class="dot" style="--acct:${esc(acct(t.account_id)?.color || '#999')}"></span>${esc(acct(t.account_id)?.code || '—')}</td><td>${esc(t.label)}</td><td class="r">${amt(t.amount)}</td>
            <td class="r"><button class="btn ghost sm danger" data-del-transfer="${t.id}">Padam</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted small">Tiada. Guna ini bila satu pindahan meliputi beberapa item (cth TNG RM250).</p>'}
      </div>`;

    $('#editPeriod').onclick = () => periodDialog(p);
    $('#addTransfer').onclick = () => transferDialog(p);
    $$('[data-del-transfer]', body).forEach((b) => (b.onclick = async () => {
      if (!confirm('Padam pindahan ini?')) return;
      await q(sb.from('transfers').delete().eq('id', b.dataset.delTransfer)); await reload();
    }));
    $$('.chip', body).forEach((b) => (b.onclick = async () => {
      const item = S.items.find((i) => i.id === b.dataset.item); const e = entOf(item.id);
      if (b.dataset.note) return entryNoteDialog(p, item, e);
      const next = e?.status === b.dataset.st ? 'pending' : b.dataset.st; // tekan semula = batal
      await upsertEntry(p.id, item.id, { status: next });
    }));
  }

  async function upsertEntry(periodId, itemId, patch) {
    const e = S.entries.find((x) => x.period_id === periodId && x.item_id === itemId);
    const row = { period_id: periodId, item_id: itemId, status: e?.status || 'pending', amount: e?.amount ?? null, note: e?.note ?? null, ...patch };
    const data = await q(sb.from('entries').upsert(row, { onConflict: 'period_id,item_id' }).select().single());
    S.entries = S.entries.filter((x) => !(x.period_id === periodId && x.item_id === itemId)).concat(data);
    render();
  }

  function renderMatrix(body, dr) {
    const ps = S.periods.slice(); // terbaru di kiri
    // lajur draf: bulan seterusnya yg belum dibuka, item aktif ditunjuk sebagai belum
    const dHead = dr ? `<th class="draft">${shortMonth(dr.month)}<br><span class="small">~${new Date(dr.payday + 'T00:00:00').getDate()}/${new Date(dr.payday + 'T00:00:00').getMonth() + 1}</span><br><button class="btn primary sm" data-open-draft>＋ Buka</button></th>` : '';
    const dCell = (i) => (dr ? `<td class="draft">${i.active && !(i.end_date && i.end_date < dr.month) ? (i.paid_by === 'company' ? '<span class="sym-company">Co</span>' : '<span class="draft-dot" title="Belum">○</span>') : ''}</td>` : '');
    const its = S.items.filter((i) => i.active || S.entries.some((e) => e.item_id === i.id));
    const sym = (e) => {
      if (!e) return '';
      if (e.status === 'done') return `<span class="sym-done" title="${esc(e.note || '')}">✓</span>`;
      if (e.status === 'skip') return '<span class="sym-skip">0</span>';
      if (e.status === 'missed') return '<span class="sym-missed">X</span>';
      if (e.status === 'company') return '<span class="sym-company">Co</span>';
      if (e.status === 'other') return `<span class="sym-other">${esc(e.note || '?')}</span>`;
      return '<span class="muted">·</span>';
    };
    body.innerHTML = `<div class="card"><div class="tbl-wrap"><table class="matrix">
      <thead><tr><th>Item</th><th class="amt-col">Amaun</th>${dHead}${ps.map((p) => `<th>${shortMonth(p.month)}<br><span class="small">${p.payday ? new Date(p.payday + 'T00:00:00').getDate() + '/' + (new Date(p.payday + 'T00:00:00').getMonth() + 1) : ''}</span></th>`).join('')}</tr></thead>
      <tbody>
        ${its.map((i) => `<tr><td><span class="dot" style="--acct:${esc(acct(i.account_id)?.color || '#999')}"></span>${esc(i.name)}</td><td class="amt-col"><span class="amt ${i.paid_by === 'company' ? 'muted' : ''}">${i.active ? rm(i.amount) : ''}</span></td>${dCell(i)}${ps.map((p) => `<td>${sym(S.entries.find((e) => e.period_id === p.id && e.item_id === i.id))}</td>`).join('')}</tr>`).join('')}
        <tr><td><b>Saving</b></td><td class="amt-col"></td>${dr ? '<td class="draft muted">—</td>' : ''}${ps.map((p) => `<td><b>${p.leftover === null ? '' : `<span class="amt">${Math.round(num(p.leftover))}</span>`}</b></td>`).join('')}</tr>
      </tbody></table></div>
      <p class="muted small">✓ dah bayar · 0 tak bayar · X terlepas · Co company · ○ draf (bulan belum dibuka) · teks = nota asal sheet. Hover ✓ untuk nota (cth "Pindahan gabung").</p></div>`;
    const w = $('table.matrix th', body)?.offsetWidth || 0;
    $$('table.matrix .amt-col', body).forEach((c) => { c.style.left = w + 'px'; });
  }

  // ================= DIALOG helper =================
  function dialog(html, onSubmit) {
    const d = $('#dlg'), f = $('#dlgForm');
    f.innerHTML = html + `<p class="err" id="dlgErr"></p><div class="dlg-actions"><button class="btn ghost" type="button" id="dlgCancel">Batal</button><button class="btn primary" type="submit">Simpan</button></div>`;
    f.oninput = null; // borang dikongsi semua dialog; buang pendengar dialog sebelum ni
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { const ok = await onSubmit(new FormData(f)); if (ok !== false) d.close(); }
      catch (err) { $('#dlgErr').textContent = err.message || String(err); }
    };
    $('#dlgCancel').onclick = () => d.close();
    d.showModal();
    f.querySelector('input,select,textarea')?.focus();
  }
  const optAccounts = (sel) => `<option value="">— tiada —</option>` + S.accounts.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.code)} · ${esc(a.role || '')}</option>`).join('');
  const nOrNull = (v) => (v === '' || v == null ? null : Number(v));

  async function reload() { await loadAll(); render(); }

  function nextMonthIso() {
    const last = S.periods[0]?.month;
    const d = last ? new Date(last + 'T00:00:00') : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    if (last) d.setMonth(d.getMonth() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }

  function newPeriodDialog(dr) {
    const m = nextMonthIso();
    const payday = dr?.month === m ? dr.payday : `${m.slice(0, 8)}25`;
    dialog(`<h2>Bulan baru</h2>
      <label>Bulan<input name="month" type="month" value="${m.slice(0, 7)}" required></label>
      <label>Tarikh gaji masuk<input name="payday" type="date" value="${payday}"></label>
      <label>Pendapatan (RM)<input name="income" type="number" step="0.01" min="0" value="${num(slipOf(m)?.net) || income()}" required></label>
      <p class="muted small">Semua item aktif akan dimasukkan sebagai "belum". Item company ditanda "Co".</p>`, async (fd) => {
      const month = fd.get('month') + '-01';
      if (S.periods.some((p) => p.month === month)) throw new Error('Bulan ini dah wujud.');
      const p = await q(sb.from('periods').insert({ month, payday: fd.get('payday') || null, income: Number(fd.get('income')) }).select().single());
      const rows = S.items.filter((i) => i.active && !(i.end_date && i.end_date < month)).map((i) => ({ period_id: p.id, item_id: i.id, status: i.paid_by === 'company' ? 'company' : 'pending' }));
      if (rows.length) await q(sb.from('entries').insert(rows));
      S.periodId = p.id; await reload(); toast('Bulan ' + monthLabel(month) + ' dibuka.');
    });
  }

  function periodDialog(p) {
    dialog(`<h2>${monthLabel(p.month)}</h2>
      <label>Tarikh gaji masuk<input name="payday" type="date" value="${p.payday || ''}"></label>
      <label>Pendapatan (RM)<input name="income" type="number" step="0.01" min="0" value="${num(p.income)}" required></label>
      <label>Baki / Saving bulan ni (RM)<input name="leftover" type="number" step="0.01" value="${p.leftover ?? ''}" placeholder="kosong = belum kira"></label>
      <label>Nota<textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></label>
      <label class="check"><input type="checkbox" name="closed" ${p.closed ? 'checked' : ''}> Tutup bulan ini</label>
      <button type="button" class="btn ghost danger sm" id="delPeriod">Padam bulan ini</button>`, async (fd) => {
      await q(sb.from('periods').update({ payday: fd.get('payday') || null, income: Number(fd.get('income')), leftover: nOrNull(fd.get('leftover')), notes: fd.get('notes') || null, closed: fd.get('closed') === 'on' }).eq('id', p.id));
      await reload();
    });
    $('#delPeriod').onclick = async () => {
      if (!confirm(`Padam ${monthLabel(p.month)} berserta semua rekodnya? (Masih ada dalam audit log)`)) return;
      await q(sb.from('periods').delete().eq('id', p.id)); $('#dlg').close(); S.periodId = null; await reload();
    };
  }

  function entryNoteDialog(p, item, e) {
    dialog(`<h2>${esc(item.name)} · ${monthLabel(p.month)}</h2>
      <label>Status<select name="status">${[{ k: 'pending', label: 'Belum' }, ...STATUS, { k: 'other', label: 'Lain (ikut nota)' }].map((s) => `<option value="${s.k}" ${(e?.status || 'pending') === s.k ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
      <label>Amaun sebenar (RM)<input name="amount" type="number" step="0.01" min="0" value="${e?.amount ?? ''}" placeholder="kosong = ${num(item.amount)}"></label>
      <label>Nota<input name="note" value="${esc(e?.note || '')}" maxlength="200"></label>`, async (fd) => {
      await upsertEntry(p.id, item.id, { status: fd.get('status'), amount: nOrNull(fd.get('amount')), note: fd.get('note') || null });
    });
  }

  function transferDialog(p) {
    dialog(`<h2>Pindahan gabung · ${monthLabel(p.month)}</h2>
      <label>Akaun<select name="account_id">${optAccounts('')}</select></label>
      <label>Untuk (item)<input name="label" required placeholder="cth Spotify + iCloud + Shopee"></label>
      <label>Amaun (RM)<input name="amount" type="number" step="0.01" min="0" required></label>`, async (fd) => {
      await q(sb.from('transfers').insert({ period_id: p.id, account_id: fd.get('account_id') || null, label: fd.get('label'), amount: Number(fd.get('amount')) }));
      await reload();
    });
  }

  // ================= ITEM =================
  function renderItems(v) {
    const f = S.itemFilter || 'all', fk = S.itemKind || 'all';
    const tot = (list) => round2(list.filter((i) => i.active && i.paid_by === 'self').reduce((s, i) => s + num(i.amount), 0));
    const inB = (k) => S.items.filter((i) => k === 'all' || i.bucket === k);
    const inK = (list) => list.filter((i) => fk === 'all' || i.kind === fk || (fk === 'none' && !KINDS[i.kind]));
    const rows = (f === 'invest' ? inK(inB('invest')) : inB(f)).sort(itemOrder);
    const pill = (attr, k, label, list, on) => `<button class="pill ${on ? 'on' : ''}" ${attr}="${k}">${label} <span class="small">${list.filter((i) => i.active).length} · ${rm(tot(list))}</span></button>`;
    const inv = inB('invest');
    v.innerHTML = `<div class="card">
      <div class="card-h"><h2>Item bajet bulanan</h2><button class="btn primary sm" id="addItem">＋ Item</button></div>
      <div class="pills">${pill('data-f', 'all', 'Semua', S.items, f === 'all')}${Object.entries(BUCKETS).map(([k, l]) => pill('data-f', k, l, inB(k), f === k)).join('')}</div>
      ${f === 'invest' ? `<div class="pills sub">${pill('data-k', 'all', 'Semua jenis', inv, fk === 'all')}${Object.entries(KINDS).map(([k, l]) => pill('data-k', k, l, inv.filter((i) => i.kind === k), fk === k)).join('')}
        ${inv.some((i) => !KINDS[i.kind]) ? pill('data-k', 'none', 'Belum ditanda', inv.filter((i) => !KINDS[i.kind]), fk === 'none') : ''}</div>` : ''}
      <div class="tbl-wrap"><table><thead><tr><th>Item</th><th>Kategori</th><th>Akaun</th><th class="r">Amaun</th><th>Bayar oleh</th><th>Rujukan</th><th></th></tr></thead><tbody>
        ${rows.map((i, idx) => `<tr class="${i.active ? '' : 'inactive'}"><td><b>${esc(i.name)}</b>${i.end_date ? endBadge(i) : ''}${i.notes ? `<details class="note"><summary>Nota</summary><div>${esc(i.notes)}</div></details>` : ''}</td><td>${BUCKETS[i.bucket]}${i.bucket === 'invest' && i.kind ? `<div class="muted small">${KINDS[i.kind]}</div>` : ''}</td>
          <td><span class="dot" style="--acct:${esc(acct(i.account_id)?.color || '#999')}"></span>${esc(acct(i.account_id)?.code || '—')}</td>
          <td class="r">${amt(i.amount)}</td><td>${i.paid_by === 'company' ? 'Company' : 'Sendiri'}</td><td class="small"><span class="amt">${esc(i.ref_no || '')}</span></td>
          <td class="r"><button class="btn ghost sm" data-move-item="${i.id}" data-dir="-1" title="Naik" aria-label="Naik ${esc(i.name)}" ${idx === 0 ? 'disabled' : ''}>↑</button><button class="btn ghost sm" data-move-item="${i.id}" data-dir="1" title="Turun" aria-label="Turun ${esc(i.name)}" ${idx === rows.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn ghost sm" data-edit="${i.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Tiada item.</td></tr>'}
      </tbody></table></div></div>`;
    $$('[data-f]', v).forEach((b) => (b.onclick = () => { S.itemFilter = b.dataset.f; S.itemKind = 'all'; renderItems(v); }));
    $$('[data-k]', v).forEach((b) => (b.onclick = () => { S.itemKind = b.dataset.k; renderItems(v); }));
    // telefon: pill aktif mungkin di luar skrin (baris boleh swipe), tarik ke tengah
    $$('.pills', v).forEach((row) => { const on = $('.pill.on', row); if (on && row.scrollWidth > row.clientWidth) row.scrollLeft = on.offsetLeft - row.offsetLeft - (row.clientWidth - on.offsetWidth) / 2; });
    // item baru ikut tapisan semasa
    $('#addItem').onclick = () => itemDialog(null, f !== 'all' ? { bucket: f, kind: f === 'invest' && KINDS[fk] ? fk : null } : undefined);
    $$('[data-edit]', v).forEach((b) => (b.onclick = () => itemDialog(S.items.find((i) => i.id === b.dataset.edit))));
    $$('[data-move-item]', v).forEach((b) => (b.onclick = () => moveItem(b.dataset.moveItem, Number(b.dataset.dir), rows)));
  }

  // susunan item: aktif dulu, kemudian sort, nama (susunan sama tetap stabil)
  const itemOrder = (a, b) => (b.active - a.active) || a.sort - b.sort || a.name.localeCompare(b.name);

  // tukar dengan jiran yg NAMPAK dalam tapisan semasa, kemudian nomborkan semula semua item 1..n
  async function moveItem(id, dir, visible) {
    const i = visible.findIndex((x) => x.id === id), other = visible[i + dir];
    if (i < 0 || !other) return;
    const all = S.items.slice().sort(itemOrder);
    const a = all.findIndex((x) => x.id === id), b = all.findIndex((x) => x.id === other.id);
    [all[a], all[b]] = [all[b], all[a]];
    const changed = all.map((x, k) => ({ x, sort: k + 1 })).filter(({ x, sort }) => x.sort !== sort);
    await Promise.all(changed.map(({ x, sort }) => q(sb.from('items').update({ sort }).eq('id', x.id))));
    await reload();
  }

  // bulan bil yg tinggal hingga tarikh tamat (negatif = dah tamat)
  const monthsLeft = (end) => (end < todayIso() ? -1 : monthsBetween(todayIso(), end));
  const endBadge = (i) => { const l = monthsLeft(i.end_date); return `<div class="small ${l < 0 ? 'bad' : l <= 3 ? 'warn' : 'muted'}">Tamat ${fmtDate(i.end_date)} · ${l < 0 ? 'dah tamat' : l + ' bulan lagi'}</div>`; };

  function itemDialog(it, prefill) {
    const i = it || { name: '', amount: 0, bucket: 'komitmen', account_id: '', paid_by: 'self', ref_no: '', notes: '', sort: (S.items.at(-1)?.sort || 0) + 1, active: true, ...prefill };
    dialog(`<h2>${it ? 'Edit item' : 'Item baru'}</h2>
      <label>Nama<input name="name" value="${esc(i.name)}" required maxlength="60"></label>
      <div class="grid g2"><label>Amaun (RM)<input name="amount" type="number" step="0.01" min="0" value="${num(i.amount)}" required></label>
        <label>Kategori<select name="bucket">${Object.entries(BUCKETS).map(([k, l]) => `<option value="${k}" ${i.bucket === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <label>Jenis (untuk Invest)<select name="kind"><option value="">—</option>${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${i.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="grid g2"><label>Akaun<select name="account_id">${optAccounts(i.account_id)}</select></label>
        <label>Bayar oleh<select name="paid_by"><option value="self" ${i.paid_by === 'self' ? 'selected' : ''}>Sendiri</option><option value="company" ${i.paid_by === 'company' ? 'selected' : ''}>Company</option></select></label></div>
      <label>No. rujukan / akaun<input name="ref_no" value="${esc(i.ref_no || '')}" maxlength="60"></label>
      <label>Nota<input name="notes" value="${esc(i.notes || '')}" maxlength="200"></label>
      <label>Tarikh tamat (pilihan)<input name="end_date" type="date" value="${i.end_date || ''}"><span class="muted small">Untuk kontrak / ansuran: kira bulan tinggal & peringatan</span></label>
      <div class="grid g2"><label>Susunan<input name="sort" type="number" value="${i.sort}"></label>
        <label class="check"><input type="checkbox" name="active" ${i.active ? 'checked' : ''}> Aktif</label></div>`, async (fd) => {
      const row = { name: fd.get('name').trim(), amount: Number(fd.get('amount')), bucket: fd.get('bucket'), kind: fd.get('bucket') === 'invest' ? (fd.get('kind') || null) : null, account_id: fd.get('account_id') || null,
        paid_by: fd.get('paid_by'), ref_no: fd.get('ref_no') || null, notes: fd.get('notes') || null, end_date: fd.get('end_date') || null, sort: Number(fd.get('sort')) || 0, active: fd.get('active') === 'on' };
      // rekod lama tanpa amaun khusus ikut amaun semasa item; kunci dulu supaya sejarah tak berubah
      if (it && num(it.amount) !== row.amount) await q(sb.from('entries').update({ amount: num(it.amount) }).eq('item_id', it.id).is('amount', null));
      if (it) await q(sb.from('items').update(row).eq('id', it.id)); else await q(sb.from('items').insert(row));
      await reload(); toast('Item disimpan.');
    });
  }

  // ================= PINJAMAN =================
  function renderLoans(v) {
    v.innerHTML = `<div class="row"><h2 class="grow">Pinjaman</h2><button class="btn primary sm" id="addLoan">＋ Pinjaman</button></div>
      <div class="grid g2">${S.loans.map((l) => {
        const pays = S.payments.filter((p) => p.loan_id === l.id);
        const paidTotal = pays.reduce((s, p) => s + num(p.amount), 0);
        // baki = baki penyata terakhir − bayaran yg dibuat selepas penyata tu (anggaran, tanpa ujrah baru)
        const bi = pays.findIndex((p) => p.balance_after != null);
        const bal = bi >= 0 ? num(pays[bi].balance_after) - pays.slice(0, bi).reduce((s, p) => s + num(p.amount), 0)
          : (l.original_amount != null ? num(l.original_amount) - paidTotal : null);
        const pct = l.original_amount && bal != null ? Math.max(0, Math.min(100, (1 - bal / num(l.original_amount)) * 100)) : null;
        const mon = num(l.monthly);
        const totalInst = l.start_date && l.end_date ? monthsBetween(l.start_date, l.end_date) + 1 : null;
        const leftSched = totalInst != null ? Math.max(0, totalInst - pays.length) : null;
        const leftBal = bal != null && mon > 0 ? Math.ceil(round2(bal / mon)) : null;
        const extra = leftSched != null && bal != null && mon > 0 ? round2(leftSched * mon - bal) : null;
        return `<div class="card">
          <div class="card-h"><h2>${esc(l.name)}</h2><div class="row"><button class="btn ghost sm" data-edit-loan="${l.id}">Edit</button><button class="btn sm" data-pay="${l.id}">＋ Bayaran</button></div></div>
          <div class="grid g3">
            <div class="kpi"><div class="lbl">Baki</div><div class="val">${bal == null ? '—' : amt(bal)}</div>${bi > 0 ? '<div class="sub">anggaran selepas penyata</div>' : ''}</div>
            <div class="kpi"><div class="lbl">Bulanan</div><div class="val">${l.monthly == null ? '—' : amt(l.monthly)}</div></div>
            <div class="kpi"><div class="lbl">Ansuran lagi</div><div class="val">${leftSched ?? leftBal ?? '—'}</div>
              <div class="sub">${totalInst != null ? `${pays.length}/${totalInst} dah bayar · tamat ${fmtDate(l.end_date)}` : 'ikut baki'}</div></div>
          </div>
          ${pct != null ? `<div class="bar" style="margin-top:12px"><i data-w="${pct}"></i></div><div class="muted small">Baki turun ${Math.round(pct)}% dari ${rm(l.original_amount)} · ${pays.length} bayaran = ${rm(paidTotal)}</div>` : ''}
          ${extra != null && extra > 0 ? `<p class="small warn">Ikut jadual, ${leftSched} × ${rm(mon)} = ${amt(leftSched * mon)}, iaitu ${amt(extra)} lebih dari baki (anggaran ujrah/kos). Kalau baki je dikira: ${leftBal} ansuran.</p>` : ''}
          ${l.notes ? `<p class="muted small">${esc(l.notes)}</p>` : ''}
          ${pays.length ? `<div class="tbl-wrap"><table><thead><tr><th>Tarikh</th><th class="r">Bayar</th><th class="r">Baki</th><th>Nota</th><th></th></tr></thead><tbody>
            ${pays.map((p) => `<tr><td>${fmtDate(p.paid_on)}</td><td class="r">${amt(p.amount)}</td><td class="r">${p.balance_after == null ? '' : amt(p.balance_after)}</td><td class="small">${esc(p.note || '')}</td>
              <td class="r"><button class="btn ghost sm danger" data-del-pay="${p.id}">✕</button></td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted small">Belum ada rekod bayaran.</p>'}
        </div>`;
      }).join('') || '<div class="card muted">Tiada pinjaman.</div>'}</div>`;
    $$('.bar > i', v).forEach((i) => { i.style.width = i.dataset.w + '%'; });
    $('#addLoan').onclick = () => loanDialog(null);
    $$('[data-edit-loan]', v).forEach((b) => (b.onclick = () => loanDialog(S.loans.find((l) => l.id === b.dataset.editLoan))));
    $$('[data-pay]', v).forEach((b) => (b.onclick = () => payDialog(S.loans.find((l) => l.id === b.dataset.pay))));
    $$('[data-del-pay]', v).forEach((b) => (b.onclick = async () => { if (!confirm('Padam rekod bayaran ini?')) return; await q(sb.from('loan_payments').delete().eq('id', b.dataset.delPay)); await reload(); }));
  }

  function loanDialog(l) {
    const x = l || { name: '', provider: '', ref_no: '', original_amount: '', monthly: '', start_date: '', notes: '' };
    dialog(`<h2>${l ? 'Edit pinjaman' : 'Pinjaman baru'}</h2>
      <label>Nama<input name="name" value="${esc(x.name)}" required></label>
      <div class="grid g2"><label>Pemberi<input name="provider" value="${esc(x.provider || '')}"></label><label>No. rujukan<input name="ref_no" value="${esc(x.ref_no || '')}"></label></div>
      <div class="grid g2"><label>Jumlah asal (RM)<input name="original_amount" type="number" step="0.01" value="${x.original_amount ?? ''}"></label><label>Bayaran bulanan (RM)<input name="monthly" type="number" step="0.01" value="${x.monthly ?? ''}"></label></div>
      <div class="grid g2"><label>Tarikh mula bayar<input name="start_date" type="date" value="${x.start_date || ''}"></label><label>Tarikh tamat bayar<input name="end_date" type="date" value="${x.end_date || ''}"></label></div>
      <label>Nota<input name="notes" value="${esc(x.notes || '')}"></label>`, async (fd) => {
      const row = { name: fd.get('name'), provider: fd.get('provider') || null, ref_no: fd.get('ref_no') || null, original_amount: nOrNull(fd.get('original_amount')),
        monthly: nOrNull(fd.get('monthly')), start_date: fd.get('start_date') || null, end_date: fd.get('end_date') || null, notes: fd.get('notes') || null };
      if (l) await q(sb.from('loans').update(row).eq('id', l.id)); else await q(sb.from('loans').insert(row));
      await reload();
    });
  }

  function payDialog(l) {
    const today = new Date().toISOString().slice(0, 10);
    dialog(`<h2>Bayaran ${esc(l.name)}</h2>
      <div class="grid g2"><label>Tarikh<input name="paid_on" type="date" value="${today}" required></label><label>Amaun (RM)<input name="amount" type="number" step="0.01" min="0" value="${l.monthly ?? ''}" required></label></div>
      <label>Baki selepas bayar (ikut penyata, pilihan)<input name="balance_after" type="number" step="0.01"></label>
      <label>Nota<input name="note"></label>`, async (fd) => {
      await q(sb.from('loan_payments').insert({ loan_id: l.id, paid_on: fd.get('paid_on'), amount: Number(fd.get('amount')), balance_after: nOrNull(fd.get('balance_after')), note: fd.get('note') || null }));
      await reload();
    });
  }

  // ================= GAJI =================
  const SLIP_EARN = [['basic', 'Basic'], ['allowance', 'Elaun'], ['overtime', 'OT'], ['holiday', 'Cuti umum'], ['commission', 'Komisen']];
  const SLIP_DED = [['epf', 'KWSP'], ['socso', 'PERKESO'], ['eis', 'EIS'], ['skbbk', 'SKBBK'], ['pcb', 'PCB'], ['staff_house', 'Staff house'], ['other_deduction', 'Lain']];
  const SLIP_ER = [['epf_employer', 'KWSP'], ['socso_employer', 'PERKESO'], ['eis_employer', 'EIS']];

  function renderPayslips(v) {
    const ps = S.payslips;
    const last = ps[0];
    const yr = last ? last.month.slice(0, 4) : '';
    const ytd = ps.filter((s) => s.month.startsWith(yr));
    const sum = (rows, k) => round2(rows.reduce((t, s) => t + num(s[k]), 0));
    const stat = last ? round2(num(last.epf) + num(last.socso) + num(last.eis) + num(last.skbbk) + num(last.pcb)) : 0;
    v.innerHTML = `<div class="row"><h2 class="grow">Slip gaji</h2><button class="btn sm" id="importSlip">Import PDF</button><button class="btn primary sm" id="addSlip">＋ Slip</button>
        <input type="file" id="slipFile" accept="application/pdf" multiple hidden></div>
      <div id="importBox"></div>
      ${last ? `<div class="grid g4">
        <div class="card kpi"><div class="lbl">Gaji kasar terkini</div><div class="val">${amt(last.gross)}</div><div class="sub">${monthLabel(last.month)} · basic ${rm(last.basic)}</div></div>
        <div class="card kpi"><div class="lbl">Gaji bersih terkini</div><div class="val good">${amt(last.net)}</div><div class="sub">Masuk bank · ${Math.round((num(last.net) / num(last.gross)) * 100)}% dari kasar</div></div>
        <div class="card kpi"><div class="lbl">Potongan bulanan</div><div class="val">${amt(round2(num(last.gross) - num(last.net)))}</div><div class="sub">Statutori ${rm(stat)} · rumah ${rm(last.staff_house)}</div></div>
        <div class="card kpi"><div class="lbl">KWSP ${yr} (anda + majikan)</div><div class="val">${amt(sum(ytd, 'epf') + sum(ytd, 'epf_employer'))}</div><div class="sub">${rm(sum(ytd, 'epf'))} + ${rm(sum(ytd, 'epf_employer'))}</div></div>
      </div>
      <div class="card"><div class="card-h"><h2>Jumlah ${yr} setakat ${monthLabel(last.month)}</h2></div>
        <div class="grid g3">
          <div class="kpi"><div class="lbl">Kasar</div><div class="val">${amt(sum(ytd, 'gross'))}</div></div>
          <div class="kpi"><div class="lbl">Bersih</div><div class="val">${amt(sum(ytd, 'net'))}</div></div>
          <div class="kpi"><div class="lbl">Purata bersih / bulan</div><div class="val">${amt(ytd.length ? sum(ytd, 'net') / ytd.length : 0)}</div><div class="sub">${ytd.length} bulan</div></div>
        </div></div>` : ''}
      <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Bulan</th><th class="r">Kasar</th><th class="r">Bersih</th><th class="r">KWSP</th><th class="r">PERKESO+EIS</th><th class="r">SKBBK</th><th class="r">Rumah</th><th>Jawatan</th><th>Nota</th><th></th></tr></thead><tbody>
        ${ps.map((s) => `<tr><td>${monthLabel(s.month)}</td><td class="r">${amt(s.gross)}</td><td class="r"><b>${amt(s.net)}</b></td><td class="r">${amt(s.epf)}</td>
          <td class="r">${amt(round2(num(s.socso) + num(s.eis)))}</td><td class="r">${num(s.skbbk) ? amt(s.skbbk) : '—'}</td><td class="r">${num(s.staff_house) ? amt(s.staff_house) : '—'}</td>
          <td class="small">${esc(s.position || '')}</td><td class="small muted">${esc(s.note || '')}</td><td class="r"><button class="btn ghost sm" data-edit-slip="${s.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="10" class="muted">Belum ada slip.</td></tr>'}
      </tbody></table></div></div>
      ${ps.length ? '<div id="ebeBox"></div>' : ''}`;
    $('#addSlip').onclick = () => slipDialog(null);
    $('#importSlip').onclick = () => $('#slipFile').click();
    $('#slipFile').onchange = (e) => { importSlips([...e.target.files]); e.target.value = ''; };
    if (ps.length) renderEbe($('#ebeBox'));
    $$('[data-edit-slip]', v).forEach((b) => (b.onclick = () => slipDialog(S.payslips.find((s) => s.id === b.dataset.editSlip))));
  }

  const SLIP_KEYS = [...SLIP_EARN, ...SLIP_DED, ...SLIP_ER].map(([k]) => k);

  async function saveSlip(row, month, existing) {
    if (existing) await q(sb.from('payslips').update(row).eq('id', existing.id));
    else await q(sb.from('payslips').insert({ ...row, month }));
    // pendapatan bulan tu = gaji bersih slip; slip terkini = pendapatan bulanan dalam tetapan
    const p = S.periods.find((pp) => pp.month === month);
    if (p && num(p.income) !== row.net) await q(sb.from('periods').update({ income: row.net }).eq('id', p.id));
    if (month >= (S.payslips[0]?.month || '')) await q(sb.from('settings').upsert({ key: 'income', value: row.net }));
  }

  // prefill: angka dari PDF (boleh untuk bulan baru atau ganti slip sedia ada)
  function slipDialog(sl, prefill) {
    // slip baru: salin angka tetap dari slip terakhir, OT/cuti/komisen kosong
    const last = S.payslips[0] || {};
    const base = sl || { ...Object.fromEntries(SLIP_KEYS.map((k) => [k, last[k] ?? 0])), overtime: 0, holiday: 0, commission: 0,
      position: last.position || '', note: '', month: last.month ? (() => { const d = new Date(last.month + 'T00:00:00'); d.setMonth(d.getMonth() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; })() : nextMonthIso() };
    const x = prefill ? { ...base, ...prefill } : base;
    const f = ([k, l]) => `<label>${l}<input name="${k}" type="number" step="0.01" min="0" value="${num(x[k])}"></label>`;
    dialog(`<h2>${sl ? 'Edit slip ' + monthLabel(sl.month) : 'Slip gaji baru'}</h2>
      <div class="grid g2"><label>Bulan<input name="month" type="month" value="${x.month.slice(0, 7)}" required ${sl ? 'disabled' : ''}></label><label>Jawatan<input name="position" value="${esc(x.position || '')}"></label></div>
      <h3>Pendapatan</h3><div class="grid g3">${SLIP_EARN.map(f).join('')}</div>
      <h3>Potongan</h3><div class="grid g3">${SLIP_DED.map(f).join('')}</div>
      <h3>Caruman majikan</h3><div class="grid g3">${SLIP_ER.map(f).join('')}</div>
      <label>Nota<input name="note" value="${esc(x.note || '')}" maxlength="200"></label>
      <p class="muted small" id="slipCalc"></p>
      ${sl ? '<button type="button" class="btn ghost danger sm" id="delSlip">Padam slip ini</button>' : ''}`, async (fd) => {
      const row = Object.fromEntries(SLIP_KEYS.map((k) => [k, num(fd.get(k))]));
      row.gross = round2(SLIP_EARN.reduce((t, [k]) => t + row[k], 0));
      row.net = round2(row.gross - SLIP_DED.reduce((t, [k]) => t + row[k], 0));
      Object.assign(row, { position: fd.get('position') || null, note: fd.get('note') || null });
      const month = sl ? sl.month : fd.get('month') + '-01';
      if (!sl && slipOf(month)) throw new Error('Slip bulan ini dah wujud.');
      await saveSlip(row, month, sl);
      await reload(); toast('Slip disimpan · bersih ' + rm(row.net));
    });
    const form = $('#dlgForm');
    const calc = () => {
      const g = SLIP_EARN.reduce((t, [k]) => t + num(form.elements[k].value), 0);
      const d = SLIP_DED.reduce((t, [k]) => t + num(form.elements[k].value), 0);
      $('#slipCalc').innerHTML = `Kasar <b>${rm(g)}</b> − potongan ${rm(d)} = bersih <b>${rm(g - d)}</b>. Pastikan sama dengan NETT INCOME pada slip.`;
    };
    form.oninput = calc; calc();
    if (sl) $('#delSlip').onclick = async () => {
      if (!confirm(`Padam slip ${monthLabel(sl.month)}?`)) return;
      await q(sb.from('payslips').delete().eq('id', sl.id)); $('#dlg').close(); await reload();
    };
  }

  // ---------- import PDF (dibaca dalam browser, fail tak dimuat naik) ----------
  let pdfLib;
  function loadPdfJs() {
    if (!pdfLib) pdfLib = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'vendor/pdf.min.js';
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; res(window.pdfjsLib); };
      s.onerror = () => { pdfLib = null; rej(new Error('Gagal muat pembaca PDF.')); };
      document.head.appendChild(s);
    });
    return pdfLib;
  }

  async function importSlips(files) {
    const box = $('#importBox');
    if (!files.length) return;
    box.innerHTML = '<div class="card muted">Membaca PDF…</div>';
    let lib;
    try { lib = await loadPdfJs(); } catch (e) { box.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; return; }
    const res = [];
    for (const f of files) {
      try { res.push({ file: f.name, ...(await window.ZF_SLIP.fromPdf(lib, new Uint8Array(await f.arrayBuffer()))) }); }
      catch (e) { res.push({ file: f.name, error: e.message }); }
    }
    res.sort((a, b) => (a.month || '').localeCompare(b.month || ''));
    const rowOf = (r) => {
      const ex = slipOf(r.month);
      return { ...Object.fromEntries(SLIP_KEYS.map((k) => [k, r[k]])), gross: r.gross, net: r.net, position: r.position || ex?.position || S.payslips[0]?.position || null,
        note: r.unknown.length ? r.unknown.join('; ') : (ex?.note ?? null) };
    };
    const state = (r) => {
      if (r.error || !r.month) return { cls: 'bad', txt: 'Tak dapat baca format slip ini', can: false };
      if (!r.ok) return { cls: 'bad', txt: `Tak sepadan dengan slip (kasar ${rm(r.slip_gross)}, bersih ${rm(r.slip_net)}). Buka & semak.`, can: false };
      const ex = slipOf(r.month);
      if (!ex) return { cls: 'good', txt: 'Baru', can: true, on: true };
      const same = SLIP_KEYS.concat('gross', 'net').every((k) => num(ex[k]) === num(r[k]));
      return same ? { cls: 'muted', txt: 'Dah ada, sama', can: false } : { cls: 'warn', txt: 'Dah ada, angka berbeza. Tick untuk ganti', can: true, on: false };
    };
    const st = res.map(state);
    box.innerHTML = `<div class="card"><div class="card-h"><h2>Import ${res.length} PDF</h2><span class="muted small">Dibaca dalam browser, PDF tak dimuat naik</span></div>
      <div class="tbl-wrap"><table><thead><tr><th></th><th>Bulan</th><th class="r">Kasar</th><th class="r">Bersih</th><th>Status</th><th></th></tr></thead><tbody>
        ${res.map((r, i) => `<tr><td><input type="checkbox" data-imp="${i}" ${st[i].on ? 'checked' : ''} ${st[i].can ? '' : 'disabled'} aria-label="Simpan"></td>
          <td>${r.month ? monthLabel(r.month) : esc(r.file)}</td><td class="r">${r.month ? amt(r.gross) : ''}</td><td class="r">${r.month ? `<b>${amt(r.net)}</b>` : ''}</td>
          <td class="small ${st[i].cls}">${esc(st[i].txt)}${r.unknown?.length ? `<div class="warn">${esc(r.unknown.join('; '))}</div>` : ''}</td>
          <td class="r">${r.month ? `<button class="btn ghost sm" data-imp-open="${i}">Buka</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="impSave">Simpan yang ditick</button><button class="btn ghost" id="impClose">Tutup</button></div></div>`;
    $('#impClose').onclick = () => { box.innerHTML = ''; };
    $$('[data-imp-open]', box).forEach((b) => (b.onclick = () => { const r = res[b.dataset.impOpen]; slipDialog(slipOf(r.month) || null, { ...rowOf(r), month: r.month }); }));
    $('#impSave').onclick = async () => {
      const pick = $$('[data-imp]:checked', box).map((c) => res[c.dataset.imp]);
      if (!pick.length) return toast('Tiada slip ditick.', true);
      for (const r of pick) await saveSlip(rowOf(r), r.month, slipOf(r.month));
      box.innerHTML = ''; await reload(); toast(`${pick.length} slip disimpan.`);
    };
  }

  // ---------- pembantu e-BE (anggaran, Borang EA tetap sumber rasmi) ----------
  // Kadar cukai pemastautin (jadual YA2025)
  const TAX_BANDS = [[5000, 0], [20000, 0.01], [35000, 0.03], [50000, 0.06], [70000, 0.11], [100000, 0.19], [400000, 0.25], [600000, 0.26], [2000000, 0.28], [Infinity, 0.30]];
  function taxOf(ci) {
    let t = 0, lo = 0;
    for (const [hi, r] of TAX_BANDS) { if (ci > lo) t += (Math.min(ci, hi) - lo) * r; lo = hi; }
    return round2(ci <= 35000 ? Math.max(0, t - 400) : t); // rebat individu RM400
  }

  function renderEbe(box) {
    const years = [...new Set(S.payslips.map((s) => s.month.slice(0, 4)))].sort().reverse();
    if (!S.ebeYear || !years.includes(S.ebeYear)) S.ebeYear = years[0];
    const yr = S.ebeYear;
    const rows = S.payslips.filter((s) => s.month.startsWith(yr));
    const n = rows.length, lastRow = rows[0];
    const proj = S.ebeProj !== false && n < 12; // anggaran 12 bulan guna slip terakhir tahun tu
    const tot = (k) => round2(rows.reduce((t, s) => t + num(s[k]), 0) + (proj ? (12 - n) * num(lastRow[k]) : 0));
    const saved = S.settings['ebe_' + yr] || {};
    const gross = tot('gross'), epf = tot('epf'), sosEis = round2(tot('socso') + tot('eis')), pcb = tot('pcb');
    const life = num(saved.life), other = num(saved.other);
    const rel = [
      ['Individu', 9000, 9000],
      ['KWSP (had RM4,000)', epf, Math.min(epf, 4000)],
      ['PERKESO + EIS (had RM350)', sosEis, Math.min(sosEis, 350)],
      ['Insurans hayat / takaful keluarga (had RM3,000)', life, Math.min(life, 3000)],
      ['Pelepasan lain (anda isi)', other, other],
    ];
    const relief = round2(rel.reduce((t, r) => t + r[2], 0));
    const ci = Math.max(0, round2(gross - relief));
    const tax = taxOf(ci), bal = round2(tax - pcb);
    const takaful = S.items.find((i) => i.active && /takaful/i.test(i.name));
    box.innerHTML = `<div class="card"><div class="card-h"><h2>Pembantu e-BE ${yr}</h2>
        <div class="row"><select id="ebeYear" aria-label="Tahun" style="width:auto">${years.map((y) => `<option ${y === yr ? 'selected' : ''}>${y}</option>`).join('')}</select>
          ${n < 12 ? `<button class="btn ghost sm" id="ebeProj">${proj ? `Tunjuk ${n} bulan sebenar` : 'Anggaran 12 bulan'}</button>` : ''}</div></div>
      <p class="muted small">${proj ? `Anggaran setahun: ${n} slip sebenar + ${12 - n} bulan ikut slip ${monthLabel(lastRow.month)}.` : `${n} slip sebenar.`}</p>
      <div class="tbl-wrap"><table class="ebe"><tbody>
        <tr><td><b>Pendapatan penggajian (kasar)</b></td><td class="r"><b>${amt(gross)}</b></td></tr>
        ${rel.map(([l, raw, use]) => `<tr><td>− ${l}${raw !== use ? ` <span class="small muted">(sebenar ${rm(raw)})</span>` : ''}</td><td class="r">${amt(use)}</td></tr>`).join('')}
        <tr><td><b>Pendapatan bercukai</b></td><td class="r"><b>${amt(ci)}</b></td></tr>
        <tr><td>Anggaran cukai${ci <= 35000 ? ' (selepas rebat RM400)' : ''}</td><td class="r">${amt(tax)}</td></tr>
        <tr><td>PCB dah dipotong</td><td class="r">${amt(pcb)}</td></tr>
        <tr><td><b>${bal > 0 ? 'Anggaran perlu bayar' : bal < 0 ? 'Anggaran refund' : 'Baki'}</b></td><td class="r"><b class="${bal > 0 ? 'bad' : 'good'}">${amt(Math.abs(bal))}</b></td></tr>
      </tbody></table></div>
      <form id="ebeForm" class="grid g3" style="margin-top:12px">
        <label>Takaful hayat setahun (RM)<input name="life" type="number" step="0.01" min="0" value="${life || ''}" placeholder="${takaful ? rm(num(takaful.amount) * 12).replace('RM', '') : '0'}"></label>
        <label>Pelepasan lain (RM)<input name="other" type="number" step="0.01" min="0" value="${other || ''}" placeholder="0"></label>
        <button class="btn" type="submit" style="align-self:end">Simpan pelepasan</button>
      </form>
      <ul class="muted small">
        ${takaful ? `<li>${esc(takaful.name)} ${rm(takaful.amount)}/bulan = ${rm(num(takaful.amount) * 12)} setahun. Semak sijil: bahagian hayat masuk ruang hayat, bahagian perubatan masuk pelepasan insurans perubatan.</li>` : ''}
        <li>Pelepasan lain contohnya gaya hidup (buku, gajet, internet), sukan dan pemeriksaan perubatan. Simpan resit 7 tahun.</li>
        <li>SKBBK tak dimasukkan sebab kelayakan pelepasannya belum pasti.</li>
        <li>Angka rasmi ikut Borang EA dari majikan (sebelum 28 Feb). Isi e-BE di MyTax sebelum 30 April. Kadar cukai ikut jadual YA2025, jadi ini anggaran sahaja.</li>
      </ul></div>`;
    $('#ebeYear').onchange = (e) => { S.ebeYear = e.target.value; renderEbe(box); };
    if ($('#ebeProj')) $('#ebeProj').onclick = () => { S.ebeProj = !proj; renderEbe(box); };
    $('#ebeForm').onsubmit = async (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      await q(sb.from('settings').upsert({ key: 'ebe_' + yr, value: { life: num(fd.get('life')), other: num(fd.get('other')) } }));
      await reload(); toast('Pelepasan ' + yr + ' disimpan.');
    };
  }

  // ================= TETAPAN =================
  function renderSettings(v) {
    const sp = split();
    v.innerHTML = `
      <div class="grid g2">
        <div class="card"><div class="card-h"><h2>Pendapatan &amp; peraturan bajet</h2></div>
          <form id="setForm" class="stack">
            <label>Pendapatan bulanan (RM)<input name="income" type="number" step="0.01" min="0" value="${income()}" required></label>
            <div class="grid g3">${Object.entries(BUCKETS).map(([k, l]) => `<label>${l} %<input name="${k}" type="number" min="0" max="100" value="${num(sp[k])}" required></label>`).join('')}</div>
            <button class="btn primary" type="submit">Simpan</button>
          </form></div>
        <div class="card"><div class="card-h"><h2>Data &amp; keselamatan</h2></div>
          <div class="stack">
            <p class="muted small">Data disimpan dalam Supabase (bukan dalam repo GitHub). Akses: akaun anda sahaja + kod 2FA. Tab ditutup = log keluar. Tiada aktiviti 15 minit = log keluar.</p>
            <div class="row"><button class="btn" id="expJson">Eksport JSON (backup penuh)</button><button class="btn" id="expCsv">Eksport CSV rekod</button></div>
            <button class="btn ghost" id="showAudit">Lihat audit log (50 terakhir)</button>
          </div></div>
      </div>
      <div class="card"><div class="card-h"><h2>Akaun bank / e-wallet</h2><button class="btn sm" id="addAcct">＋ Akaun</button></div>
        <div class="tbl-wrap"><table><thead><tr><th>Kod</th><th>Nama</th><th>No. Acc</th><th>Peranan</th><th class="r">Had simpanan</th><th></th></tr></thead><tbody>
          ${S.accounts.map((a, idx) => `<tr class="${a.active ? '' : 'inactive'}"><td><span class="dot" style="--acct:${esc(a.color)}"></span><b>${esc(a.code)}</b></td><td>${esc(a.name)}</td>
            <td>${a.account_no ? `<span class="amt acc-no">${esc(maskAcc(a.account_no))}</span> <button class="btn ghost sm" data-copy-acct="${a.id}" title="Salin nombor penuh">Salin</button>` : '<span class="muted">—</span>'}</td><td>${esc(a.role || '')}</td>
            <td class="r">${a.balance_cap ? amt(a.balance_cap) : '—'}</td>
            <td class="r nowrap"><button class="btn ghost sm" data-move-acct="${a.id}" data-dir="-1" title="Naik" aria-label="Naik ${esc(a.code)}" ${idx === 0 ? 'disabled' : ''}>↑</button><button class="btn ghost sm" data-move-acct="${a.id}" data-dir="1" title="Turun" aria-label="Turun ${esc(a.code)}" ${idx === S.accounts.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="btn ghost sm" data-edit-acct="${a.id}">Edit</button></td></tr>`).join('')}
        </tbody></table></div></div>
      <div id="auditBox"></div>`;
    $('#setForm').onsubmit = async (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      const s = Object.fromEntries(Object.keys(BUCKETS).map((k) => [k, Number(fd.get(k))]));
      if (Object.values(s).reduce((a, b) => a + b, 0) !== 100) return toast('Jumlah peratus mesti 100%.', true);
      await q(sb.from('settings').upsert([{ key: 'income', value: Number(fd.get('income')) }, { key: 'split', value: s }]));
      await reload(); toast('Tetapan disimpan.');
    };
    $('#addAcct').onclick = () => acctDialog(null);
    $$('[data-edit-acct]', v).forEach((b) => (b.onclick = () => acctDialog(S.accounts.find((a) => a.id === b.dataset.editAcct))));
    $$('[data-move-acct]', v).forEach((b) => (b.onclick = () => moveAcct(b.dataset.moveAcct, Number(b.dataset.dir))));
    $$('[data-copy-acct]', v).forEach((b) => (b.onclick = async () => {
      const a = S.accounts.find((x) => x.id === b.dataset.copyAcct);
      try { await navigator.clipboard.writeText(a.account_no.replace(/[\s-]/g, '')); toast(`No. akaun ${a.code} disalin.`); }
      catch (_) { toast('Tak dapat salin. Buka Edit untuk lihat nombor penuh.', true); }
    }));
    $('#expJson').onclick = exportJson;
    $('#expCsv').onclick = exportCsv;
    $('#showAudit').onclick = showAudit;
  }

  // tukar kedudukan akaun, kemudian nomborkan semula 1..n (betulkan susunan sama/berlubang)
  async function moveAcct(id, dir) {
    const list = S.accounts.slice();
    const i = list.findIndex((a) => a.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const changed = list.map((a, k) => ({ a, sort: k + 1 })).filter(({ a, sort }) => a.sort !== sort);
    await Promise.all(changed.map(({ a, sort }) => q(sb.from('accounts').update({ sort }).eq('id', a.id))));
    await reload();
  }

  // tunjuk 4 digit terakhir sahaja (elak terdedah bila skrin dikongsi)
  const maskAcc = (n) => { const d = String(n).replace(/\D/g, ''); return d.length > 4 ? '•••• ' + d.slice(-4) : d; };

  function acctDialog(a) {
    const x = a || { code: '', name: '', role: '', color: '#888888', balance_cap: '', cap_note: '', sort: S.accounts.length + 1, active: true };
    dialog(`<h2>${a ? 'Edit akaun' : 'Akaun baru'}</h2>
      <div class="grid g2"><label>Kod<input name="code" value="${esc(x.code)}" required maxlength="10"></label><label>Warna<input name="color" type="color" value="${esc(x.color)}"></label></div>
      <label>Nama<input name="name" value="${esc(x.name)}" required></label>
      <label>No. akaun<input name="account_no" value="${esc(x.account_no || '')}" inputmode="numeric" autocomplete="off" maxlength="40" pattern="[0-9 \\-]*" title="Nombor, ruang atau sengkang sahaja" placeholder="cth 1234 5678 9012"></label>
      <label>Peranan<input name="role" value="${esc(x.role || '')}" placeholder="cth Daily, Masuk Gaji"></label>
      <div class="grid g2"><label>Had simpanan (RM)<input name="balance_cap" type="number" step="0.01" value="${x.balance_cap ?? ''}"></label><label>Susunan<input name="sort" type="number" value="${x.sort}"></label></div>
      <label>Nota had<input name="cap_note" value="${esc(x.cap_note || '')}"></label>
      <label class="check"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> Aktif</label>`, async (fd) => {
      const row = { code: fd.get('code').trim().toUpperCase(), name: fd.get('name'), account_no: fd.get('account_no').trim() || null, role: fd.get('role') || null, color: fd.get('color'), balance_cap: nOrNull(fd.get('balance_cap')),
        cap_note: fd.get('cap_note') || null, sort: Number(fd.get('sort')) || 0, active: fd.get('active') === 'on' };
      if (a) await q(sb.from('accounts').update(row).eq('id', a.id)); else await q(sb.from('accounts').insert(row));
      await reload();
    });
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  function exportJson() {
    const { settings, accounts, items, periods, entries, transfers, loans, payments, payslips } = S;
    download(`zak-financial-backup-${stamp()}.json`, JSON.stringify({ exported_at: new Date().toISOString(), settings, accounts, items, periods, entries, transfers, loans, loan_payments: payments, payslips }, null, 2), 'application/json');
  }
  function exportCsv() {
    const cell = (s) => { const t = String(s ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [['bulan', 'tarikh_gaji', 'item', 'kategori', 'akaun', 'status', 'amaun', 'nota'].join(',')];
    for (const p of S.periods.slice().reverse()) {
      for (const e of S.entries.filter((x) => x.period_id === p.id)) {
        const i = S.items.find((x) => x.id === e.item_id) || {};
        lines.push([p.month.slice(0, 7), p.payday, i.name, i.bucket, acct(i.account_id)?.code, e.status, e.amount ?? i.amount, e.note].map(cell).join(','));
      }
    }
    download(`zak-financial-rekod-${stamp()}.csv`, '﻿' + lines.join('\n'), 'text/csv');
  }
  async function showAudit() {
    const rows = await q(sb.from('audit_log').select('at,tbl,op,row_id').order('id', { ascending: false }).limit(50));
    $('#auditBox').innerHTML = `<div class="card"><div class="card-h"><h2>Audit log</h2></div><div class="tbl-wrap"><table><thead><tr><th>Masa</th><th>Jadual</th><th>Operasi</th><th>ID</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(new Date(r.at).toLocaleString('en-MY'))}</td><td>${esc(r.tbl)}</td><td>${esc(r.op)}</td><td class="small muted">${esc(String(r.row_id || '').slice(0, 8))}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  }

  // ---------- boot ----------
  if (!C.url || !C.key) { document.body.innerHTML = '<p style="padding:20px">config.js belum diisi.</p>'; return; }
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') showLogin(); });
  route();
})();
