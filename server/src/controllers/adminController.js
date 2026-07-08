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
      total: productAgg.reduce((a, r) => a + r.n, 0),
      active: prodByStatus.active || 0,
      soldout: prodByStatus.soldout || 0,
      draft: prodByStatus.draft || 0,
    },
    recentOrders: f.recent,
  });
}
