import Order from '../models/Order.js';
import { applyTransition, TRANSITIONS } from '../services/orderTransitionService.js';

const MAX_BULK = 100;
const ORDER_NUMBER_RE = /^\d{8}-\d{6}$/;

// 건별 결과 수집 공통 — 실패는 건너뛰고 사유를 모은다(부분 성공).
async function runEach(entries, run) {
  const failed = [];
  let succeeded = 0;
  for (const entry of entries) {
    // 순차 실행 — 같은 주문 중복 선택 등 경합 없이 결정적으로 처리
    // eslint-disable-next-line no-await-in-loop
    const r = await run(entry).catch((e) => ({ ok: false, message: e?.message || '처리 실패' }));
    if (r.ok) succeeded += 1;
    else failed.push({ orderId: r.orderId || '', orderNumber: r.orderNumber || '', message: r.message });
  }
  return { succeeded, failed };
}

// POST /orders/bulk/status (admin) — 선택 주문 일괄 전이. 건별 applyTransition.
export async function bulkStatus(req, res) {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
  const status = String(req.body.status || '');
  const trackings = req.body.trackings && typeof req.body.trackings === 'object' ? req.body.trackings : {};

  if (ids.length < 1 || ids.length > MAX_BULK) {
    return res.status(400).json({ message: `처리할 주문은 1~${MAX_BULK}건이어야 합니다.` });
  }
  const validTargets = new Set(Object.values(TRANSITIONS).flat());
  if (!validTargets.has(status)) {
    return res.status(400).json({ message: '잘못된 상태입니다.' });
  }

  const result = await runEach(ids, async (id) => {
    const t = trackings[id] || {};
    const r = await applyTransition(id, status, { courier: t.courier, trackingNumber: t.trackingNumber, actor: 'admin' });
    if (r.ok) return r;
    const o = await Order.findById(id).select('orderNumber').catch(() => null);
    return { ok: false, orderId: id, orderNumber: o?.orderNumber || '', message: r.message };
  });
  return res.json(result);
}

// POST /orders/bulk/tracking (admin) — 송장 CSV 업로드분 일괄 배송처리(preparing→shipped).
export async function bulkTracking(req, res) {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length < 1 || rows.length > MAX_BULK) {
    return res.status(400).json({ message: `처리할 행은 1~${MAX_BULK}건이어야 합니다.` });
  }

  const result = await runEach(rows, async (row) => {
    const orderNumber = String(row?.orderNumber || '').trim();
    if (!ORDER_NUMBER_RE.test(orderNumber)) {
      return { ok: false, orderNumber, message: '주문번호 형식 오류' };
    }
    const order = await Order.findOne({ orderNumber }).select('_id');
    if (!order) return { ok: false, orderNumber, message: '주문을 찾을 수 없습니다.' };
    const r = await applyTransition(order._id, 'shipped', {
      courier: String(row?.courier || '').trim(),
      trackingNumber: String(row?.trackingNumber || '').trim(),
      actor: 'admin',
    });
    if (r.ok) return r;
    return { ok: false, orderId: String(order._id), orderNumber, message: r.message };
  });
  return res.json(result);
}
