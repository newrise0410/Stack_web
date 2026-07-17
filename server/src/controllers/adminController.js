import Order, { SALES_STATES } from '../models/Order.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import PointTransaction from '../models/PointTransaction.js';
import OrderEvent from '../models/OrderEvent.js';
import WebhookLog from '../models/WebhookLog.js';
import { getLastCycle } from '../services/paymentJobs.js';

function dayStart(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function monthStart(d = new Date()) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

// 대시보드 집계 — GET /admin/stats
export async function getStats(req, res) {
  const today = dayStart();
  const month = monthStart();

  const [orderAgg, productAgg, memberCounts] = await Promise.all([
    Order.aggregate([
      { $addFields: { salesDate: { $ifNull: ['$payment.paidAt', '$createdAt'] } } },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
          salesToday: [
            { $match: { status: { $in: SALES_STATES }, salesDate: { $gte: today } } },
            { $group: { _id: null, s: { $sum: '$amounts.grandTotal' } } },
          ],
          salesMonth: [
            { $match: { status: { $in: SALES_STATES }, salesDate: { $gte: month } } },
            { $group: { _id: null, s: { $sum: '$amounts.grandTotal' } } },
          ],
          recent: [
            { $sort: { createdAt: -1 } },
            { $limit: 5 },
            {
              $project: {
                orderNumber: 1,
                createdAt: 1,
                status: 1,
                grandTotal: '$amounts.grandTotal',
                recipient: '$shippingAddress.recipient',
              },
            },
          ],
        },
      },
    ]),
    Product.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Promise.all([User.countDocuments(), User.countDocuments({ createdAt: { $gte: today } })]),
  ]);

  const f = orderAgg[0];
  const byStatus = Object.fromEntries(f.byStatus.map((r) => [r._id, r.n]));
  const prodByStatus = Object.fromEntries(productAgg.map((r) => [r._id, r.n]));

  res.json({
    sales: { today: f.salesToday[0]?.s || 0, month: f.salesMonth[0]?.s || 0 },
    orders: byStatus,
    toHandle: (byStatus.paid || 0) + (byStatus.preparing || 0),
    members: { total: memberCounts[0], newToday: memberCounts[1] },
    products: {
      // archived(소프트삭제)는 제외 → 카드 합(active+soldout+draft)과 total이 일치
      total: productAgg.filter((r) => r._id !== 'archived').reduce((a, r) => a + r.n, 0),
      active: prodByStatus.active || 0,
      soldout: prodByStatus.soldout || 0,
      draft: prodByStatus.draft || 0,
    },
    recentOrders: f.recent,
  });
}

// 분석 — GET /admin/analytics?period=7d|30d|12m (admin)
const TZ = 'Asia/Seoul';
const pad = (n) => String(n).padStart(2, '0');
// 서버/DB 프로세스 TZ와 무관하게 항상 KST(Asia/Seoul) 기준의 날짜 구성요소를 얻는다.
// ($dateToString은 timezone:TZ로 KST 라벨을 만들므로, 갭필 라벨도 KST로 맞춰야 매칭됨)
function kstParts(date) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date).split('-').map(Number);
  return { y, m, d };
}

export async function getAnalytics(req, res) {
  const period = ['7d', '30d', '12m'].includes(req.query.period) ? req.query.period : '30d';
  const monthly = period === '12m';
  const fmt = monthly ? '%Y-%m' : '%Y-%m-%d';

  // 오늘(KST) 기준으로 라벨 시퀀스를 UTC 날짜 산술로 생성 → 프로세스 TZ에 의존하지 않음
  const { y, m, d } = kstParts(new Date());
  const labels = [];
  if (monthly) {
    for (let k = 11; k >= 0; k--) {
      const dt = new Date(Date.UTC(y, m - 1 - k, 1)); // 월 오버플로 자동 정규화
      labels.push(`${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`);
    }
  } else {
    const days = period === '7d' ? 7 : 30;
    for (let k = days - 1; k >= 0; k--) {
      const dt = new Date(Date.UTC(y, m - 1, d - k)); // 일 오버플로 자동 정규화
      labels.push(`${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`);
    }
  }
  // $match 하한 = 첫 버킷의 KST 자정(= 해당 날짜 UTC 자정 - 9시간)의 절대 시각
  const first = monthly ? new Date(Date.UTC(y, m - 1 - 11, 1)) : new Date(Date.UTC(y, m - 1, d - (period === '7d' ? 6 : 29)));
  const start = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()) - 9 * 3600 * 1000);

  const [agg] = await Order.aggregate([
    { $addFields: { salesDate: { $ifNull: ['$payment.paidAt', '$createdAt'] } } },
    { $match: { status: { $in: SALES_STATES }, salesDate: { $gte: start } } },
    {
      $facet: {
        series: [
          { $group: { _id: { $dateToString: { format: fmt, date: '$salesDate', timezone: TZ } }, revenue: { $sum: '$amounts.grandTotal' }, orders: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ],
        bestSellers: [
          { $unwind: '$items' },
          { $group: { _id: '$items.name', units: { $sum: '$items.qty' }, revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } } } },
          { $sort: { revenue: -1 } },
          { $limit: 5 },
        ],
        typeSales: [
          { $unwind: '$items' },
          { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'p' } },
          { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
          { $group: { _id: { $ifNull: ['$p.type', '기타'] }, revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } }, units: { $sum: '$items.qty' } } },
          { $sort: { revenue: -1 } },
        ],
      },
    },
  ]);

  // 매출 없는 날/월도 0으로 채워 시간축을 연속으로 (라벨은 위에서 KST로 생성)
  const byLabel = new Map(agg.series.map((r) => [r._id, r]));
  const series = labels.map((label) => ({
    label,
    revenue: byLabel.get(label)?.revenue || 0,
    orders: byLabel.get(label)?.orders || 0,
  }));

  res.json({
    period,
    series,
    bestSellers: agg.bestSellers.map((r) => ({ name: r._id, units: r.units, revenue: r.revenue })),
    typeSales: agg.typeSales.map((r) => ({ type: r._id, revenue: r.revenue, units: r.units })),
  });
}

// 회원 상세 — GET /admin/members/:id (admin). 프로필 + 주문 + 집계.
export async function getMember(req, res) {
  // 생년월일·성별 제외 — 회원 관리(주문·적립금·쿠폰)에 필요한 정보가 아니다. 열람 최소화.
  const user = await User.findById(req.params.id).select('-birthday -gender');
  if (!user) return res.status(404).json({ message: '회원을 찾을 수 없습니다.' });
  const orders = await Order.find({ user: user._id }).sort({ createdAt: -1 });
  const totalSpent = orders
    .filter((o) => SALES_STATES.includes(o.status))
    .reduce((a, o) => a + o.amounts.grandTotal, 0);
  // 적립금 잔액 + 최근 내역
  const pointTransactions = await PointTransaction.find({ user: user._id }).sort({ createdAt: -1, _id: -1 }).limit(20);
  res.json({
    user,
    orders,
    orderCount: orders.length,
    totalSpent,
    points: user.points || 0,
    pointTransactions,
  });
}

// 운영 상태 — GET /admin/ops
// 지금까지 stdout에만 있던 '조용한 실패'들을 한곳에 센다. 값이 0이 아니면 사람이 개입할 일이 있다는 뜻.
export async function getOps(req, res) {
  const [failedEvents, webhookErrors, refundReview, benefitsStuck] = await Promise.all([
    OrderEvent.countDocuments({ status: 'failed' }), // 재시도 소진 — salesCount 불일치·메일 미발송
    WebhookLog.countDocuments({ result: 'error' }), // 포트원 웹훅 처리 실패
    Order.countDocuments({ 'payment.refund.status': 'review' }), // 환불 실패로 격리된 주문(데드락)
    Order.countDocuments({ status: 'cancelled', benefitsReversed: false }), // 취소됐는데 쿠폰·적립 원복 실패
  ]);
  res.json({
    counts: { failedEvents, webhookErrors, refundReview, benefitsStuck },
    lastCycle: getLastCycle(), // { at, ok, counts } | null — 결제 잡이 살아 있는지
  });
}

// outbox 이벤트 목록 — GET /admin/events?status=failed&page=
export async function listEvents(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = {};
  const status = String(req.query.status || '');
  if (['pending', 'processing', 'done', 'failed'].includes(status)) filter.status = status;
  const [items, total] = await Promise.all([
    OrderEvent.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('order', 'orderNumber'),
    OrderEvent.countDocuments(filter),
  ]);
  res.json({ page, limit, total, items });
}

// outbox 이벤트 수동 재큐 — POST /admin/events/:id/requeue
// failed만 대상. pending으로 되돌리고 attempts를 초기화하면 다음 잡 사이클이 다시 집어간다.
//
// ⚠️ exactly-once가 아니다. uniqueKey는 '중복 enqueue'만 막고 '같은 row 재실행'은 못 막는다.
//    runEvent의 부수효과(adjustSales $inc, EmailMessage.create)는 멱등하지 않아, 부수효과가
//    이미 1회 적용된 뒤 done-write만 실패해 failed가 된 이벤트를 재큐하면 salesCount가 이중
//    가산되거나 메일이 중복 생성된다. 이건 재큐가 새로 만든 문제가 아니라 outbox의 기존
//    at-least-once 성질이다(stale-processing 재큐도 동일). 근본 해법은 runEvent+done-write의
//    트랜잭션 원자화 — 별도 작업으로 로드맵에 있다. 그전까지 재큐는 '진짜 미적용 실패'에만
//    쓰고, 부수효과가 적용됐는지 애매하면 lastError를 확인할 것. UI에서 이 위험을 경고한다.
export async function requeueEvent(req, res) {
  const ev = await OrderEvent.findById(req.params.id).catch(() => null);
  if (!ev) return res.status(404).json({ message: '이벤트를 찾을 수 없습니다.' });
  if (ev.status !== 'failed') {
    return res.status(400).json({ message: '영구 실패한 이벤트만 재큐할 수 있습니다.' });
  }
  await OrderEvent.updateOne(
    { _id: ev._id, status: 'failed' }, // CAS — 그 사이 잡이 손댔으면 무시
    { $set: { status: 'pending', attempts: 0, lastError: '' } },
  );
  res.json({ ok: true });
}
