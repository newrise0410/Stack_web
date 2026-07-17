import OrderEvent from '../models/OrderEvent.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import { adjustSales } from './salesService.js';
import { sendOrderPlaced, sendOrderStatus } from './emailService.js';

const MAX_ATTEMPTS = 5;
const STALE_PROCESSING_MS = 5 * 60 * 1000; // claim 후 이 시간 넘게 processing이면 워커 크래시로 간주하고 재큐

// paid 확정 시 예약할 부수효과. payload에 수신자 스냅샷을 넣는다 — 웹훅/잡 경로엔 req.user가 없다.
export function buildPaidEvents(order, user) {
  const snapshot = user ? { name: user.name, email: user.email } : null;
  return [
    { type: 'paid_email', payload: { user: snapshot } },
    { type: 'paid_sales_inc', payload: {} },
  ];
}

export function buildCancelEvents(order) {
  return [
    { type: 'cancel_email', payload: {} },
    { type: 'cancel_sales_dec', payload: {} },
  ];
}

// 상태 전이와 같은 트랜잭션에서 호출. uniqueKey가 exactly-once 장벽 — 중복(11000)은 정상.
export async function enqueueEvents(orderId, events, session) {
  if (!events?.length) return;
  const docs = events.map((e) => ({
    order: orderId,
    type: e.type,
    uniqueKey: `${orderId}:${e.type}`,
    payload: e.payload || {},
  }));
  try {
    await OrderEvent.insertMany(docs, { session: session || undefined, ordered: false });
  } catch (e) {
    // ordered:false — 중복 키만 걸러지고 나머지는 insert됨. 중복 외 오류는 전파.
    if (e.code !== 11000 && !e.writeErrors?.every?.((w) => w.code === 11000)) throw e;
  }
}

async function loadRecipient(order, payload) {
  // 스냅샷에 _id를 복원해서 돌려준다 — emailService가 `user?._id`로 EmailMessage.user를 채우는데
  // buildPaidEvents의 스냅샷엔 _id가 없어 지금까지 outbox 경로의 메일은 전부 user:null로
  // 저장됐다. 그 탓에 마이페이지 메일함(user 기준 조회)이 주문 접수 메일을 못 보여주고,
  // 탈퇴 시 user 기준 파기도 이 메일들을 놓친다. order.user에서 복원하면 이미 큐에 쌓인
  // 옛 이벤트까지 소급 교정된다.
  if (payload?.user?.email) return { ...payload.user, _id: order.user };

  // ⚠️ status를 select에서 빼면 아래 가드가 **조용히 무력화**된다 — Mongoose는 프로젝션으로
  //    제외된 path에 default를 채우지 않으므로 undefined !== 'withdrawn'이 되고 예외도 안 난다.
  const u = await User.findById(order.user).select('name email status');
  // 탈퇴 tombstone에는 메일을 보내지 않는다. 탈퇴 시 payload.user 스냅샷을 $unset하므로
  // (withdrawalService) 그 뒤의 재시도는 반드시 이 폴백으로 내려와 여기서 걸린다.
  if (!u || u.status === 'withdrawn') return null;
  return u;
}

async function runEvent(event) {
  const order = await Order.findById(event.order);
  if (!order) throw new Error(`주문 없음: ${event.order}`);
  switch (event.type) {
    case 'paid_sales_inc':
      return adjustSales(order.items, +1);
    case 'cancel_sales_dec':
      return adjustSales(order.items, -1);
    case 'paid_email': {
      const user = await loadRecipient(order, event.payload);
      if (user) await sendOrderPlaced(order, user);
      return undefined;
    }
    case 'cancel_email': {
      const user = await loadRecipient(order, event.payload);
      if (user) await sendOrderStatus(order, user);
      return undefined;
    }
    default:
      throw new Error(`알 수 없는 이벤트: ${event.type}`);
  }
}

// pending 이벤트를 CAS로 claim해 순차 실행. 반환: 처리 시도 건수.
// 실행 성공→done, 실패→attempts+1 후 pending 복귀(MAX_ATTEMPTS 도달 시 failed).
export async function processPendingEvents(limit = 20) {
  // claim 후 크래시로 고아가 된 processing 이벤트를 재큐 — attempts는 claim 시 증가했으므로
  // 반복 크래시는 MAX_ATTEMPTS에서 failed로 수렴한다. uniqueKey 덕에 재실행해도 exactly-once 유지.
  await OrderEvent.updateMany(
    { status: 'processing', updatedAt: { $lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
    { $set: { status: 'pending' } },
  );
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const event = await OrderEvent.findOneAndUpdate(
      { status: 'pending' },
      { $set: { status: 'processing' }, $inc: { attempts: 1 } },
      { new: true, sort: { updatedAt: 1 } },
    );
    if (!event) break;
    processed += 1;
    try {
      await runEvent(event);
      await OrderEvent.updateOne(
        { _id: event._id },
        { $set: { status: 'done', processedAt: new Date(), lastError: '' } },
      );
    } catch (e) {
      const failed = event.attempts >= MAX_ATTEMPTS;
      await OrderEvent.updateOne(
        { _id: event._id },
        { $set: { status: failed ? 'failed' : 'pending', lastError: String(e?.message || e).slice(0, 300) } },
      );
      if (failed) console.error('[outbox] 이벤트 영구 실패:', event.uniqueKey, e?.message);
    }
  }
  return processed;
}
