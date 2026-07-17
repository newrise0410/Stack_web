import WebhookLog from '../models/WebhookLog.js';
import { verifyAndCompletePayment } from '../services/paymentService.js';
import * as portone from '../services/portoneService.js';

// imp_uid 형식 화이트리스트 — 웹훅/complete body를 Mongo·포트원에 넘기기 전 차단
const IMP_UID_RE = /^imps?_[0-9A-Za-z_-]{4,40}$/;
// merchant_uid(주문번호) 형식 — find 폴백 힌트용. 검증 실패 시 힌트만 버린다.
const MERCHANT_UID_RE = /^\d{8}-\d{6}$/;

function merchantUidHintFrom(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  return MERCHANT_UID_RE.test(s) ? s : null;
}

function outcomeToHttp(res, r) {
  switch (r.outcome) {
    case 'paid':
    case 'already_paid':
      return res.json({ order: r.order, outcome: r.outcome });
    case 'ready':
      return res.status(202).json({ outcome: r.outcome, message: '결제가 아직 완료되지 않았습니다. 잠시 후 다시 확인해주세요.' });
    case 'failed_cancelled':
      return res.status(400).json({ outcome: r.outcome, message: '결제에 실패해 주문이 취소되었습니다.', order: r.order });
    case 'external_cancelled':
      return res.status(400).json({ outcome: r.outcome, message: '결제가 취소되어 주문이 취소되었습니다.', order: r.order });
    case 'not_found':
      return res.status(404).json({ outcome: r.outcome, message: '결제에 해당하는 주문을 찾을 수 없습니다.' });
    default: // review, duplicate_refunded, late_refund_started, noop
      return res.status(409).json({ outcome: r.outcome, message: '결제 확인이 필요합니다. 고객센터(관리자)에 문의해주세요.' });
  }
}

// POST /payments/complete (requireAuth) — 결제창 콜백/모바일 리다이렉트의 서버 검증 진입점
export async function completePayment(req, res) {
  if (!portone.isConfigured()) {
    return res.status(503).json({ message: '결제 모듈이 설정되지 않았습니다.' });
  }
  const impUid = typeof req.body?.impUid === 'string' ? req.body.impUid.trim() : '';
  if (!IMP_UID_RE.test(impUid)) {
    return res.status(400).json({ message: '잘못된 결제 식별자입니다.' });
  }
  const r = await verifyAndCompletePayment(impUid, {
    requesterId: req.user._id,
    merchantUidHint: merchantUidHintFrom(req.body?.merchantUid),
  });
  return outcomeToHttp(res, r);
}

// POST /payments/webhook (무인증) — v1 웹훅은 서명이 없으므로 body를 신뢰하지 않고
// imp_uid로 포트원 API 재조회 검증만 한다. 일시 장애는 500으로 재전송을 살린다.
export async function portoneWebhook(req, res) {
  const impUid = typeof req.body?.imp_uid === 'string' ? req.body.imp_uid.trim() : '';
  if (!IMP_UID_RE.test(impUid)) {
    return res.status(200).json({ ok: true, ignored: true }); // 영구 무효 — 재전송 불필요
  }
  let log = null;
  try {
    log = await WebhookLog.create({
      impUid,
      merchantUid: typeof req.body?.merchant_uid === 'string' ? req.body.merchant_uid.slice(0, 64) : '',
      rawStatus: typeof req.body?.status === 'string' ? req.body.status.slice(0, 32) : '',
    });
  } catch { /* 감사 로그 실패는 처리 지속 */ }

  const setLog = (result, note) =>
    log && WebhookLog.updateOne({ _id: log._id }, { $set: { result, note: String(note || '').slice(0, 200) } }).catch(() => {});

  try {
    const r = await verifyAndCompletePayment(impUid, {
      merchantUidHint: merchantUidHintFrom(req.body?.merchant_uid),
    });
    await setLog('processed', r.outcome);
    return res.status(200).json({ ok: true, outcome: r.outcome });
  } catch (e) {
    if (e instanceof portone.PortoneError) {
      // 포트원이 명시 거절(존재하지 않는 imp_uid 등) — 영구 무효, 재전송 불필요
      await setLog('ignored', e.message);
      return res.status(200).json({ ok: true, ignored: true });
    }
    // PortoneUnknownError·DB 오류 — 일시 장애로 보고 재전송 유도
    await setLog('error', e?.message);
    return res.status(500).json({ ok: false });
  }
}
