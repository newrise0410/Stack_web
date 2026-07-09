import Order from '../models/Order.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import PointTransaction from '../models/PointTransaction.js';

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
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
          salesToday: [
            { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: today } } },
            { $group: { _id: null, s: { $sum: '$amounts.grandTotal' } } },
          ],
          salesMonth: [
            { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: month } } },
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
    { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: start } } },
    {
      $facet: {
        series: [
          { $group: { _id: { $dateToString: { format: fmt, date: '$createdAt', timezone: TZ } }, revenue: { $sum: '$amounts.grandTotal' }, orders: { $sum: 1 } } },
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
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: '회원을 찾을 수 없습니다.' });
  const orders = await Order.find({ user: user._id }).sort({ createdAt: -1 });
  const totalSpent = orders
    .filter((o) => o.status !== 'cancelled')
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
