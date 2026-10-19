'use strict';
(function () {
  const C = window.ZF_CONFIG || {};
  const sb = window.supabase.createClient(C.url, C.key, {
    // sessionStorage: tutup tab = log keluar. Tiada sesi kekal dalam browser.
    auth: { persistSession: true, storage: window.sessionStorage, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const IDLE_MS = 15 * 60 * 1000;
  const BUCKETS = { komitmen: 'Komitmen', invest: 'Invest', reward: 'Self Reward' };
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

  const S = {
    settings: {}, accounts: [], items: [], periods: [], entries: [], transfers: [], loans: [], payments: [],
    view: 'ringkasan', periodId: null, matrix: false,
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
    Object.assign(S, { settings: {}, accounts: [], items: [], periods: [], entries: [], transfers: [], loans: [], payments: [] });
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
    const [settings, accounts, items, periods, entries, transfers, loans, payments] = await Promise.all([
      q(sb.from('settings').select('*')),
      q(sb.from('accounts').select('*').order('sort')),
      q(sb.from('items').select('*').order('sort')),
      q(sb.from('periods').select('*').order('month', { ascending: false })),
      q(sb.from('entries').select('*')),
      q(sb.from('transfers').select('*').order('created_at')),
      q(sb.from('loans').select('*').order('created_at')),
      q(sb.from('loan_payments').select('*').order('paid_on', { ascending: false })),
    ]);
    periods.sort((a, b) => b.month.localeCompare(a.month));
    S.settings = Object.fromEntries(settings.map((r) => [r.key, r.value]));
    Object.assign(S, { accounts, items, periods, entries, transfers, loans, payments });
    if (!S.periodId || !periods.find((p) => p.id === S.periodId)) S.periodId = periods[0]?.id || null;
  }

  const income = () => num(S.settings.income ?? 0);
  const split = () => S.settings.split || { komitmen: 60, invest: 20, reward: 20 };
  const acct = (id) => S.accounts.find((a) => a.id === id);
  const activeSelfItems = () => S.items.filter((i) => i.active && i.paid_by === 'self');

  async function startApp() {
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
    ({ ringkasan: renderSummary, rekod: renderRecord, item: renderItems, pinjaman: renderLoans, tetapan: renderSettings })[S.view](v);
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

    const byBucket = Object.keys(BUCKETS).map((k) => {
      const actual = round2(items.filter((i) => i.bucket === k).reduce((s, i) => s + num(i.amount), 0));
      const target = round2(inc * num(sp[k]) / 100);
      return { k, actual, target, pct: num(sp[k]) };
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
            const over = b.actual > b.target;
            return `<div class="bucket">
              <div class="row"><b class="grow">${BUCKETS[b.k]} <span class="muted small">${b.pct}%</span></b>
                <span class="${over ? 'bad' : ''}">${amt(b.actual)}</span><span class="muted small">/ ${amt(b.target)}</span></div>
              <div class="bar"><i class="${over ? 'over' : ''}" data-w="${w}"></i></div>
              <div class="muted small">${over ? `Lebih ${amt(b.actual - b.target)} dari sasaran` : `Baki ruang ${amt(b.target - b.actual)}`}</div>
            </div>`;
          }).join('')}
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
  function renderRecord(v) {
    const p = S.periods.find((x) => x.id === S.periodId);
    v.innerHTML = `
      <div class="card">
        <div class="row">
          <select id="periodSel" class="grow" aria-label="Pilih bulan">${S.periods.map((x) => `<option value="${x.id}" ${x.id === S.periodId ? 'selected' : ''}>${monthLabel(x.month)}</option>`).join('')}</select>
          <button class="btn primary" id="newPeriod">＋ Bulan baru</button>
          <button class="btn ghost" id="toggleMatrix">${S.matrix ? 'Senarai semak' : 'Jadual penuh'}</button>
        </div>
      </div>
      <div id="recBody"></div>`;
    $('#periodSel').onchange = (e) => { S.periodId = e.target.value; renderRecord(v); };
    $('#newPeriod').onclick = newPeriodDialog;
    $('#toggleMatrix').onclick = () => { S.matrix = !S.matrix; renderRecord(v); };
    const body = $('#recBody');
    if (S.matrix) return renderMatrix(body);
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
        <div class="card kpi"><div class="lbl">Pendapatan</div><div class="val">${amt(p.income)}</div></div>
        <div class="card kpi"><div class="lbl">Selesai</div><div class="val">${doneCount}/${its.length}</div><div class="sub">${amt(paid)} dibayar</div></div>
        <div class="card kpi"><div class="lbl">Baki / Saving</div><div class="val">${p.leftover === null ? '—' : amt(p.leftover)}</div><div class="sub">${p.closed ? 'Bulan ditutup' : 'Masih terbuka'}</div></div>
      </div>
      <div class="card">
        <div class="card-h"><h2>${monthLabel(p.month)}</h2><button class="btn sm" id="editPeriod">Edit bulan</button></div>
        ${p.notes ? `<p class="muted small">${esc(p.notes)}</p>` : ''}
        ${groups.map(({ a, list }) => `
          <div class="check-group">
            <h3><span><span class="dot" style="--acct:${esc(a?.color || '#999')}"></span>${esc(a ? `${a.code} · ${a.role || ''}` : 'Tiada akaun')}</span>
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
      </div>
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

  function renderMatrix(body) {
    const ps = S.periods.slice().reverse();
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
      <thead><tr><th>Item</th>${ps.map((p) => `<th>${shortMonth(p.month)}<br><span class="small">${p.payday ? new Date(p.payday + 'T00:00:00').getDate() + '/' + (new Date(p.payday + 'T00:00:00').getMonth() + 1) : ''}</span></th>`).join('')}</tr></thead>
      <tbody>
        ${its.map((i) => `<tr><td><span class="dot" style="--acct:${esc(acct(i.account_id)?.color || '#999')}"></span>${esc(i.name)}</td>${ps.map((p) => `<td>${sym(S.entries.find((e) => e.period_id === p.id && e.item_id === i.id))}</td>`).join('')}</tr>`).join('')}
        <tr><td><b>Saving</b></td>${ps.map((p) => `<td><b>${p.leftover === null ? '' : `<span class="amt">${Math.round(num(p.leftover))}</span>`}</b></td>`).join('')}</tr>
      </tbody></table></div>
      <p class="muted small">✓ dah bayar · 0 tak bayar · X terlepas · Co company · teks = nota asal sheet. Hover ✓ untuk nota (cth "Pindahan gabung").</p></div>`;
  }

  // ================= DIALOG helper =================
  function dialog(html, onSubmit) {
    const d = $('#dlg'), f = $('#dlgForm');
    f.innerHTML = html + `<p class="err" id="dlgErr"></p><div class="dlg-actions"><button class="btn ghost" type="button" id="dlgCancel">Batal</button><button class="btn primary" type="submit">Simpan</button></div>`;
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

  function newPeriodDialog() {
    const m = nextMonthIso();
    dialog(`<h2>Bulan baru</h2>
      <label>Bulan<input name="month" type="month" value="${m.slice(0, 7)}" required></label>
      <label>Tarikh gaji masuk<input name="payday" type="date" value="${m.slice(0, 8)}25"></label>
      <label>Pendapatan (RM)<input name="income" type="number" step="0.01" min="0" value="${income()}" required></label>
      <p class="muted small">Semua item aktif akan dimasukkan sebagai "belum". Item company ditanda "Co".</p>`, async (fd) => {
      const month = fd.get('month') + '-01';
      if (S.periods.some((p) => p.month === month)) throw new Error('Bulan ini dah wujud.');
      const p = await q(sb.from('periods').insert({ month, payday: fd.get('payday') || null, income: Number(fd.get('income')) }).select().single());
      const rows = S.items.filter((i) => i.active).map((i) => ({ period_id: p.id, item_id: i.id, status: i.paid_by === 'company' ? 'company' : 'pending' }));
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
    const rows = S.items.slice().sort((a, b) => (b.active - a.active) || a.sort - b.sort);
    v.innerHTML = `<div class="card">
      <div class="card-h"><h2>Item bajet bulanan</h2><button class="btn primary sm" id="addItem">＋ Item</button></div>
      <div class="tbl-wrap"><table><thead><tr><th>Item</th><th>Kategori</th><th>Akaun</th><th class="r">Amaun</th><th>Bayar oleh</th><th>Rujukan</th><th></th></tr></thead><tbody>
        ${rows.map((i) => `<tr class="${i.active ? '' : 'inactive'}"><td><b>${esc(i.name)}</b>${i.notes ? `<div class="muted small">${esc(i.notes)}</div>` : ''}</td><td>${BUCKETS[i.bucket]}</td>
          <td><span class="dot" style="--acct:${esc(acct(i.account_id)?.color || '#999')}"></span>${esc(acct(i.account_id)?.code || '—')}</td>
          <td class="r">${amt(i.amount)}</td><td>${i.paid_by === 'company' ? 'Company' : 'Sendiri'}</td><td class="small"><span class="amt">${esc(i.ref_no || '')}</span></td>
          <td class="r"><button class="btn ghost sm" data-edit="${i.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
    $('#addItem').onclick = () => itemDialog(null);
    $$('[data-edit]', v).forEach((b) => (b.onclick = () => itemDialog(S.items.find((i) => i.id === b.dataset.edit))));
  }

  function itemDialog(it) {
    const i = it || { name: '', amount: 0, bucket: 'komitmen', account_id: '', paid_by: 'self', ref_no: '', notes: '', sort: (S.items.at(-1)?.sort || 0) + 1, active: true };
    dialog(`<h2>${it ? 'Edit item' : 'Item baru'}</h2>
      <label>Nama<input name="name" value="${esc(i.name)}" required maxlength="60"></label>
      <div class="grid g2"><label>Amaun (RM)<input name="amount" type="number" step="0.01" min="0" value="${num(i.amount)}" required></label>
        <label>Kategori<select name="bucket">${Object.entries(BUCKETS).map(([k, l]) => `<option value="${k}" ${i.bucket === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="grid g2"><label>Akaun<select name="account_id">${optAccounts(i.account_id)}</select></label>
        <label>Bayar oleh<select name="paid_by"><option value="self" ${i.paid_by === 'self' ? 'selected' : ''}>Sendiri</option><option value="company" ${i.paid_by === 'company' ? 'selected' : ''}>Company</option></select></label></div>
      <label>No. rujukan / akaun<input name="ref_no" value="${esc(i.ref_no || '')}" maxlength="60"></label>
      <label>Nota<input name="notes" value="${esc(i.notes || '')}" maxlength="200"></label>
      <div class="grid g2"><label>Susunan<input name="sort" type="number" value="${i.sort}"></label>
        <label class="check"><input type="checkbox" name="active" ${i.active ? 'checked' : ''}> Aktif</label></div>`, async (fd) => {
      const row = { name: fd.get('name').trim(), amount: Number(fd.get('amount')), bucket: fd.get('bucket'), account_id: fd.get('account_id') || null,
        paid_by: fd.get('paid_by'), ref_no: fd.get('ref_no') || null, notes: fd.get('notes') || null, sort: Number(fd.get('sort')) || 0, active: fd.get('active') === 'on' };
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
        const lastBal = pays.find((p) => p.balance_after != null)?.balance_after;
        const bal = lastBal ?? (l.original_amount != null ? num(l.original_amount) - paidTotal : null);
        const pct = l.original_amount && bal != null ? Math.max(0, Math.min(100, (1 - bal / num(l.original_amount)) * 100)) : null;
        const monthsLeft = bal != null && num(l.monthly) > 0 ? Math.ceil(bal / num(l.monthly)) : null;
        return `<div class="card">
          <div class="card-h"><h2>${esc(l.name)}</h2><div class="row"><button class="btn ghost sm" data-edit-loan="${l.id}">Edit</button><button class="btn sm" data-pay="${l.id}">＋ Bayaran</button></div></div>
          <div class="grid g3">
            <div class="kpi"><div class="lbl">Baki</div><div class="val">${bal == null ? '—' : amt(bal)}</div></div>
            <div class="kpi"><div class="lbl">Bulanan</div><div class="val">${l.monthly == null ? '—' : amt(l.monthly)}</div></div>
            <div class="kpi"><div class="lbl">Anggaran habis</div><div class="val">${monthsLeft == null ? '—' : monthsLeft + ' bln'}</div></div>
          </div>
          ${pct != null ? `<div class="bar" style="margin-top:12px"><i data-w="${pct}"></i></div><div class="muted small">${Math.round(pct)}% dah dibayar dari ${rm(l.original_amount)}</div>` : ''}
          ${l.notes ? `<p class="muted small">${esc(l.notes)}</p>` : ''}
          ${pays.length ? `<div class="tbl-wrap"><table><thead><tr><th>Tarikh</th><th class="r">Bayar</th><th class="r">Baki</th><th>Nota</th><th></th></tr></thead><tbody>
            ${pays.slice(0, 12).map((p) => `<tr><td>${fmtDate(p.paid_on)}</td><td class="r">${amt(p.amount)}</td><td class="r">${p.balance_after == null ? '' : amt(p.balance_after)}</td><td class="small">${esc(p.note || '')}</td>
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
      <label>Tarikh mula<input name="start_date" type="date" value="${x.start_date || ''}"></label>
      <label>Nota<input name="notes" value="${esc(x.notes || '')}"></label>`, async (fd) => {
      const row = { name: fd.get('name'), provider: fd.get('provider') || null, ref_no: fd.get('ref_no') || null, original_amount: nOrNull(fd.get('original_amount')),
        monthly: nOrNull(fd.get('monthly')), start_date: fd.get('start_date') || null, notes: fd.get('notes') || null };
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
        <div class="tbl-wrap"><table><thead><tr><th>Kod</th><th>Nama</th><th>Peranan</th><th class="r">Had simpanan</th><th></th></tr></thead><tbody>
          ${S.accounts.map((a) => `<tr class="${a.active ? '' : 'inactive'}"><td><span class="dot" style="--acct:${esc(a.color)}"></span><b>${esc(a.code)}</b></td><td>${esc(a.name)}</td><td>${esc(a.role || '')}</td>
            <td class="r">${a.balance_cap ? amt(a.balance_cap) : '—'}</td><td class="r"><button class="btn ghost sm" data-edit-acct="${a.id}">Edit</button></td></tr>`).join('')}
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
    $('#expJson').onclick = exportJson;
    $('#expCsv').onclick = exportCsv;
    $('#showAudit').onclick = showAudit;
  }

  function acctDialog(a) {
    const x = a || { code: '', name: '', role: '', color: '#888888', balance_cap: '', cap_note: '', sort: S.accounts.length + 1, active: true };
    dialog(`<h2>${a ? 'Edit akaun' : 'Akaun baru'}</h2>
      <div class="grid g2"><label>Kod<input name="code" value="${esc(x.code)}" required maxlength="10"></label><label>Warna<input name="color" type="color" value="${esc(x.color)}"></label></div>
      <label>Nama<input name="name" value="${esc(x.name)}" required></label>
      <label>Peranan<input name="role" value="${esc(x.role || '')}" placeholder="cth Daily, Masuk Gaji"></label>
      <div class="grid g2"><label>Had simpanan (RM)<input name="balance_cap" type="number" step="0.01" value="${x.balance_cap ?? ''}"></label><label>Susunan<input name="sort" type="number" value="${x.sort}"></label></div>
      <label>Nota had<input name="cap_note" value="${esc(x.cap_note || '')}"></label>
      <label class="check"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> Aktif</label>`, async (fd) => {
      const row = { code: fd.get('code').trim().toUpperCase(), name: fd.get('name'), role: fd.get('role') || null, color: fd.get('color'), balance_cap: nOrNull(fd.get('balance_cap')),
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
    const { settings, accounts, items, periods, entries, transfers, loans, payments } = S;
    download(`zak-financial-backup-${stamp()}.json`, JSON.stringify({ exported_at: new Date().toISOString(), settings, accounts, items, periods, entries, transfers, loans, loan_payments: payments }, null, 2), 'application/json');
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
