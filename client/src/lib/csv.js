// 송장 CSV 파서 — 3열(주문번호, 택배사, 송장번호) 고정. 외부 라이브러리 없이
// RFC4180의 따옴표 필드만 지원(필드 내 개행은 미지원 — 송장 데이터에 불필요).
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseTrackingCsv(text) {
  const clean = String(text || '').replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  const rows = [];
  const errors = [];
  lines.forEach((line, idx) => {
    const cols = splitCsvLine(line).map((c) => c.trim());
    if (idx === 0 && /주문번호|orderNumber/i.test(cols[0])) return; // 헤더 행
    const [orderNumber = '', courier = '', trackingNumber = ''] = cols;
    if (!/^\d{8}-\d{6}$/.test(orderNumber)) {
      errors.push({ line: idx + 1, message: `주문번호 형식 오류: ${orderNumber || '(빈 값)'}` });
      return;
    }
    if (!trackingNumber) {
      errors.push({ line: idx + 1, message: `송장번호 없음: ${orderNumber}` });
      return;
    }
    rows.push({ orderNumber, courier, trackingNumber });
  });
  return { rows, errors };
}
