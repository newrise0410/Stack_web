import Order from '../models/Order.js';
import { buildAdminOrderFilter } from './orderController.js';

const MAX_ROWS = 5000;
const STATUS_LABEL = {
  pending: '결제대기', paid: '결제완료', preparing: '제작중',
  shipped: '배송중', delivered: '배송완료', cancelled: '취소',
};

// RFC4180 — 쉼표·따옴표·개행 포함 시 큰따옴표로 감싸고 내부 "는 ""로.
// 수식 인젝션 방어: 고객 입력(수취인 등)이 =,+,-,@ 로 시작하면 엑셀이 수식으로
// 해석하지 않도록 작은따옴표를 접두한다.
function csvEscape(value) {
  let s = String(value ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function kstDate(d) {
  return new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function itemsSummary(items) {
  return (items || [])
    .map((i) => `${i.nameKo || i.name || i.slug || '상품'}${i.option ? `(${i.option})` : ''}x${i.qty}`)
    .join(' / ');
}

// CSV 내보내기 — GET /orders/admin/export (admin). 필터는 listAllOrders와 동일 해석.
export async function exportOrdersCsv(req, res) {
  const filter = buildAdminOrderFilter(req.query);
  const orders = await Order.find(filter)
    .populate('user', 'name email')
    .sort({ createdAt: -1 })
    .limit(MAX_ROWS + 1);

  const truncated = orders.length > MAX_ROWS;
  const rows = (truncated ? orders.slice(0, MAX_ROWS) : orders).map((o) => [
    o.orderNumber,
    kstDate(o.createdAt),
    STATUS_LABEL[o.status] || o.status,
    o.user?.name || '',
    o.shippingAddress?.recipient || '',
    o.shippingAddress?.phone || '',
    o.shippingAddress?.zipcode || '',
    `${o.shippingAddress?.address1 || ''} ${o.shippingAddress?.address2 || ''}`.trim(),
    itemsSummary(o.items),
    o.amounts?.itemsTotal ?? '',
    o.amounts?.couponDiscount || 0,
    o.amounts?.pointsUsed || 0,
    o.amounts?.grandTotal ?? '',
    o.pointsEarned || 0,
    o.courier || '',
    o.trackingNumber || '',
  ].map(csvEscape).join(','));

  const header = '주문번호,주문일,상태,주문자,수취인,연락처,우편번호,주소,품목,상품합계,쿠폰할인,적립금사용,결제금액,적립예정,택배사,송장번호';
  const lines = [header, ...rows];
  if (truncated) lines.push(csvEscape(`※ ${MAX_ROWS}행 초과 — 기간 필터로 나눠 내려받으세요`));

  const stamp = kstDate(new Date()).slice(0, 10).replace(/-/g, '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="orders-${stamp}.csv"`);
  res.send(`﻿${lines.join('\n')}`);
}
