import Order from '../models/Order.js';
import User from '../models/User.js';
import Product from '../models/Product.js';

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
export async function getAnalytics(req, res) {
  const period = ['7d', '30d', '12m'].includes(req.query.period) ? req.query.period : '30d';
  const start = new Date();
  const monthly = period === '12m';
  let fmt;
  if (monthly) {
    // setDate(1)을 setMonth보다 먼저: 말일(29~31일) 기준 시 월 넘침(off-by-one) 방지
    start.setDate(1);
    start.setMonth(start.getMonth() - 11);
    start.setHours(0, 0, 0, 0);
    fmt = '%Y-%m';
  } else {
    const days = period === '7d' ? 7 : 30;
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);
    fmt = '%Y-%m-%d';
  }

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

  // 매출 없는 날/월도 0으로 채워 시간축을 연속으로 (서버 TZ=Asia/Seoul 기준 라벨 생성)
  const pad = (n) => String(n).padStart(2, '0');
  const labels = [];
  const cur = new Date(start);
  const now = new Date();
  if (monthly) {
    while (cur <= now) {
      labels.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}`);
      cur.setMonth(cur.getMonth() + 1);
    }
  } else {
    while (cur <= now) {
      labels.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
      cur.setDate(cur.getDate() + 1);
    }
  }
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
  res.json({ user, orders, orderCount: orders.length, totalSpent });
}
