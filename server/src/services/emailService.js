import EmailMessage from '../models/EmailMessage.js';

// 목업 이메일 서비스: 실제 전송 대신 EmailMessage 문서를 생성한다.
// 호출부는 try/catch로 감싸 메일 실패가 주문/상태변경을 막지 않게 한다.

const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;

const STATUS_LABEL = {
  paid: '결제완료',
  preparing: '상품 준비중',
  shipped: '배송중',
  delivered: '배송완료',
  cancelled: '주문취소',
};

function itemsBlock(order) {
  return order.items
    .map((it) => `· ${it.nameKo || it.name}${it.option ? ` (${it.option})` : ''} x${it.qty} — ${won(it.price * it.qty)}`)
    .join('\n');
}

function amountsBlock(order) {
  const a = order.amounts || {};
  const lines = [`상품금액   ${won(a.itemsTotal)}`];
  if (a.couponDiscount) lines.push(`쿠폰할인   -${won(a.couponDiscount)}`);
  lines.push(`배송비     ${a.shippingFee === 0 ? '무료' : won(a.shippingFee)}`);
  if (a.pointsUsed) lines.push(`적립금사용 -${won(a.pointsUsed)}`);
  lines.push(`결제금액   ${won(a.grandTotal)}`);
  return lines.join('\n');
}

// 주문 접수 메일
export function renderOrderPlaced(order) {
  const name = order.shippingAddress?.recipient || '고객';
  const subject = `[Stack N' Stak] 주문이 접수되었습니다 (${order.orderNumber})`;
  const body = [
    `${name}님, 주문이 정상 접수되었습니다.`,
    '',
    `주문번호: ${order.orderNumber}`,
    '',
    '[주문 상품]',
    itemsBlock(order),
    '',
    amountsBlock(order),
    '',
    '감사합니다. Stack N\' Stak 드림.',
  ].join('\n');
  return { subject, body };
}

// 상태 변경 메일 (배송중이면 송장 포함)
export function renderOrderStatus(order, statusLabel) {
  const name = order.shippingAddress?.recipient || '고객';
  const subject = `[Stack N' Stak] 주문 상태: ${statusLabel} (${order.orderNumber})`;
  const lines = [
    `${name}님의 주문(${order.orderNumber}) 상태가 '${statusLabel}'(으)로 변경되었습니다.`,
  ];
  if (order.status === 'shipped') {
    lines.push('', `택배사: ${order.courier || '-'}`, `송장번호: ${order.trackingNumber || '-'}`);
  }
  lines.push('', '감사합니다. Stack N\' Stak 드림.');
  return { subject, body: lines.join('\n') };
}

// 저장(목업 발송). recipientEmail이 없으면 저장하지 않음.
export async function sendMock({ to, subject, body, type, statusLabel = '', order = null, user = null }) {
  if (!to) return null;
  return EmailMessage.create({ to, subject, body, type, statusLabel, order, user });
}

// 주문 접수 메일 발송 (수신자 = 주문한 회원 이메일)
export async function sendOrderPlaced(order, userDoc) {
  const to = userDoc?.email;
  const { subject, body } = renderOrderPlaced(order);
  return sendMock({ to, subject, body, type: 'order_placed', order: order._id, user: userDoc?._id });
}

// 주문 상태 변경 메일 발송
export async function sendOrderStatus(order, userDoc) {
  const statusLabel = STATUS_LABEL[order.status] || order.status;
  const to = userDoc?.email;
  const { subject, body } = renderOrderStatus(order, statusLabel);
  return sendMock({ to, subject, body, type: 'order_status', statusLabel, order: order._id, user: userDoc?._id });
}

export { STATUS_LABEL };
