'use strict';
// Baca slip gaji (format HR "PAY SLIP FOR END-<BULAN>-<TAHUN>") dari item teks pdf.js: [{ s, x, y }].
// Semua dibuat dalam browser; PDF tak dihantar ke mana-mana.
(function (root) {
  const MON = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const isNum = (s) => /^-?[\d,]+\.\d{2}$/.test(s);
  const val = (s) => Number(s.replace(/,/g, ''));
  const r2 = (n) => Math.round(n * 100) / 100;

  const EARN = [[/BASIC/, 'basic'], [/\bOT\b|OVERTIME/, 'overtime'], [/^PH\b|HOLIDAY/, 'holiday'], [/COMMISSION/, 'commission'], [/ALLOWANCE/, 'allowance']];
  const DED = [[/EPF|KWSP/, 'epf'], [/SKBBK|LINDUNG/, 'skbbk'], [/SOCSO|PERKESO/, 'socso'], [/\bEIS\b/, 'eis'], [/PCB|MTD|TAX/, 'pcb'], [/STAFF HOUSE|HOUSE|RUMAH/, 'staff_house']];
  const ER = [[/E\.?P\.?F/, 'epf_employer'], [/SOCSO/, 'socso_employer'], [/EIS/, 'eis_employer']];

  function parse(items) {
    const out = { basic: 0, allowance: 0, overtime: 0, holiday: 0, commission: 0, epf: 0, socso: 0, eis: 0, skbbk: 0, pcb: 0, staff_house: 0, other_deduction: 0,
      epf_employer: 0, socso_employer: 0, eis_employer: 0, month: null, position: null, slip_gross: null, slip_net: null, slip_deduction: null, unknown: [] };
    // kumpul ikut baris (y hampir sama)
    const rows = [];
    for (const it of items.filter((i) => i.s && i.s.trim()).map((i) => ({ ...i, s: i.s.trim() })).sort((a, b) => b.y - a.y || a.x - b.x)) {
      const row = rows.find((r) => Math.abs(r.y - it.y) <= 3);
      if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
    }
    rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
    const all = rows.flatMap((r) => r.items);
    const head = all.find((i) => /PAY SLIP FOR/i.test(i.s));
    const m = head && head.s.toUpperCase().match(/END-([A-Z]+)-(\d{4})/);
    if (m && MON.includes(m[1])) out.month = `${m[2]}-${String(MON.indexOf(m[1]) + 1).padStart(2, '0')}-01`;

    // sempadan lajur: label kiri (INCOME) vs kanan (DEDUCTION)
    const hdr = rows.find((r) => r.items.some((i) => i.s === 'DEDUCTION'));
    const midX = hdr ? hdr.items.find((i) => i.s === 'DEDUCTION').x - 5 : 300;
    const totalRow = rows.find((r) => r.items.some((i) => /TOTAL EARNING/.test(i.s)));
    const posRow = rows.find((r) => r.items.some((i) => i.s === 'POSITION'));
    if (posRow) { const p = posRow.items.find((i) => i.x > posRow.items[0].x + 40 && i.x < midX && !/^[:\-]$/.test(i.s)); if (p) out.position = p.s.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()); }
    if (!hdr || !totalRow) return out;

    const pick = (list, lo, hi) => { const n = list.filter((i) => i.x >= lo && i.x < hi && isNum(i.s)); return n.length ? val(n[n.length - 1].s) : null; };
    for (const r of rows) {
      if (r.y >= hdr.y - 1) continue; // atas baris tajuk
      const left = r.items.filter((i) => i.x < midX), right = r.items.filter((i) => i.x >= midX);
      const lLabel = left.find((i) => !isNum(i.s))?.s.toUpperCase() || '';
      const rLabel = right.find((i) => !isNum(i.s))?.s.toUpperCase() || '';
      const lAmt = pick(left, midX - 80, midX), rAmt = pick(right, midX + 150, 10000);
      if (r.y > totalRow.y + 1) { // bahagian pendapatan / potongan
        if (lLabel && lAmt != null) { const k = EARN.find(([re]) => re.test(lLabel)); if (k) out[k[1]] = r2(out[k[1]] + lAmt); else { out.allowance = r2(out.allowance + lAmt); out.unknown.push(`${lLabel} ${lAmt.toFixed(2)} (dikira elaun)`); } }
        if (rLabel && rAmt != null) { const k = DED.find(([re]) => re.test(rLabel)); if (k) out[k[1]] = r2(out[k[1]] + rAmt); else { out.other_deduction = r2(out.other_deduction + rAmt); out.unknown.push(`${rLabel} ${rAmt.toFixed(2)} (potongan lain)`); } }
      } else if (/TOTAL EARNING/.test(lLabel)) { out.slip_gross = lAmt; out.slip_deduction = rAmt; }
      else if (/NETT INCOME/.test(lLabel)) out.slip_net = lAmt;
      else if (lLabel && lAmt != null) { const k = ER.find(([re]) => re.test(lLabel)); if (k) out[k[1]] = lAmt; }
    }
    out.gross = r2(out.basic + out.allowance + out.overtime + out.holiday + out.commission);
    out.net = r2(out.gross - out.epf - out.socso - out.eis - out.skbbk - out.pcb - out.staff_house - out.other_deduction);
    out.ok = out.month != null && out.slip_gross === out.gross && out.slip_net === out.net;
    return out;
  }

  // pdf.js -> item teks (halaman 1 sahaja)
  async function fromPdf(pdfjsLib, bytes) {
    const doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const tc = await (await doc.getPage(1)).getTextContent();
    doc.destroy();
    return parse(tc.items.map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] })));
  }

  const api = { parse, fromPdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ZF_SLIP = api;
})(typeof window !== 'undefined' ? window : globalThis);
