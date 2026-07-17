import Order from '../models/Order.js';
import * as portone from './portoneService.js';

// 포트원 사전등록(금액 변조 1차 차단)을 보장한다. 재호출 멱등.
// - 이미 prepared → no-op
// - prepare 성공 → prepared 마킹
// - "이미 등록됨" 오류 → 등록된 금액이 현재 grandTotal과 같은지 확인 후 prepared 마킹
// PortoneUnknownError는 그대로 전파 — 호출부가 preparing 유지 후 재시도 유도.
export async function ensurePrepared(order) {
  if (order.payment?.prepareStatus === 'prepared') return;
  try {
    await portone.prepare(order.orderNumber, order.amounts.grandTotal);
  } catch (e) {
    if (!(e instanceof portone.PortoneError)) throw e;
    const prep = await portone.getPrepared(order.orderNumber);
    if (!prep || prep.amount !== order.amounts.grandTotal) throw e;
  }
  await Order.updateOne(
    { _id: order._id },
    { $set: { 'payment.prepareStatus': 'prepared', 'payment.preparedAmount': order.amounts.grandTotal } },
  );
  if (order.payment) order.payment.prepareStatus = 'prepared';
}
