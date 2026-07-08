# 관리자 콘솔 Phase 1 (운영 코어) 구현 계획

> **For agentic workers:** 태스크 단위로 구현. 이 프로젝트는 단위테스트 러너가 없으므로 각 태스크의 검증은 curl 스모크 + Playwright E2E로 한다(프로젝트 확립 관례).

**Goal:** 운영자가 대시보드로 상태를 파악하고, 주문을 상세 조회·처리(상태전이/송장)할 수 있는 어드민 운영 코어를 만든다.

**Architecture:** `/admin`을 중첩 라우트 셸(AdminLayout + 사이드바 + Outlet)로 전환. 백엔드는 어드민 집계 엔드포인트(`/admin/stats`)와 주문 목록 필터/populate, 상태머신을 추가.

**Tech Stack:** Express + Mongoose(ESM, asyncHandler, requireAdmin), Vite + React Router v6 + axios, Tailwind v4 모노톤.

## Global Constraints
- 금액은 정수 KRW. 집계/상태전이는 서버 authoritative.
- 모든 어드민 API: `requireAuth, requireAdmin`.
- 스토어프론트 디자인 토큰 유지(ink/paper/line/mute/tint/sale). 신규 의존성 추가 금지.
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Order 모델 송장 필드 + 상태머신

**Files:**
- Modify: `server/src/models/Order.js` (status enum 근처)
- Modify: `server/src/controllers/orderController.js` (`updateOrderStatus`)

**Interfaces:**
- Produces: `PATCH /orders/:id/status` 바디 `{ status, courier?, trackingNumber? }`. 허용 전이만 200, 그 외 400. `shipped` 전이 시 `trackingNumber` 필수.

**전이표:**
```
pending→[paid,cancelled] paid→[preparing,cancelled] preparing→[shipped,cancelled]
shipped→[delivered,shipped(송장수정)] delivered→[] cancelled→[]
```

- [ ] **Step 1:** Order.js에 필드 추가 (paymentMethod 아래)
```js
    paymentMethod: { type: String, default: 'mock' },
    courier: { type: String, default: '' },
    trackingNumber: { type: String, default: '' },
```
- [ ] **Step 2:** orderController.js `updateOrderStatus`를 상태머신으로 교체
```js
const TRANSITIONS = {
  pending: ['paid', 'cancelled'],
  paid: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'shipped'], // 동일상태=송장수정
  delivered: [],
  cancelled: [],
};

export async function updateOrderStatus(req, res) {
  const next = String(req.body.status || '');
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });

  const allowed = TRANSITIONS[order.status] || [];
  if (!allowed.includes(next)) {
    return res.status(400).json({ message: `'${order.status}'에서 '${next}'로 변경할 수 없습니다.` });
  }
  if (next === 'shipped') {
    const tn = String(req.body.trackingNumber || '').trim();
    if (!tn) return res.status(400).json({ message: '송장번호를 입력해주세요.' });
    order.courier = String(req.body.courier || '').trim();
    order.trackingNumber = tn;
  }

  const wasCancelled = order.status === 'cancelled';
  const willCancel = next === 'cancelled';
  order.status = next;
  await order.save();
  if (willCancel && !wasCancelled) await adjustSales(order.items, -1);

  res.json(order);
}
```
- [ ] **Step 3:** 검증 (백엔드 재시작 후)
```
# paid 주문 생성 후: paid→delivered(불가)=400, paid→preparing=200, preparing→shipped(송장없이)=400, +송장=200
```
Expected: 잘못된 전이 400, 정상 전이 200, shipped 송장없음 400.
- [ ] **Step 4:** Commit `feat(order): 상태머신 전이 강제 + 송장 필드`

---

### Task 2: 어드민 대시보드 집계 엔드포인트

**Files:**
- Create: `server/src/controllers/adminController.js`
- Create: `server/src/routes/admin.js`
- Modify: `server/src/app.js` (import + mount `/admin`)

**Interfaces:**
- Produces: `GET /admin/stats` → `{ sales:{today,month}, orders:{<status>:count}, toHandle, members:{total,newToday}, products:{total,active,soldout,draft}, recentOrders:[{_id,orderNumber,createdAt,recipient,grandTotal,status}] }`

- [ ] **Step 1:** adminController.js 작성
```js
import Order from '../models/Order.js';
import User from '../models/User.js';
import Product from '../models/Product.js';

function dayStart(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function monthStart(d = new Date()) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }

export async function getStats(req, res) {
  const today = dayStart();
  const month = monthStart();
  const [orders, products, users] = await Promise.all([
    Order.aggregate([{ $facet: {
      byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
      salesToday: [{ $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: today } } }, { $group: { _id: null, s: { $sum: '$amounts.grandTotal' } } }],
      salesMonth: [{ $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: month } } }, { $group: { _id: null, s: { $sum: '$amounts.grandTotal' } } }],
      recent: [{ $sort: { createdAt: -1 } }, { $limit: 5 }, { $project: { orderNumber: 1, createdAt: 1, status: 1, grandTotal: '$amounts.grandTotal', recipient: '$shippingAddress.recipient' } }],
    } }]),
    Product.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Promise.all([User.countDocuments(), User.countDocuments({ createdAt: { $gte: today } })]),
  ]);
  const f = orders[0];
  const byStatus = Object.fromEntries(f.byStatus.map((r) => [r._id, r.n]));
  const prodByStatus = Object.fromEntries(products.map((r) => [r._id, r.n]));
  res.json({
    sales: { today: f.salesToday[0]?.s || 0, month: f.salesMonth[0]?.s || 0 },
    orders: byStatus,
    toHandle: (byStatus.paid || 0) + (byStatus.preparing || 0),
    members: { total: users[0], newToday: users[1] },
    products: { total: products.reduce((a, r) => a + r.n, 0), active: prodByStatus.active || 0, soldout: prodByStatus.soldout || 0, draft: prodByStatus.draft || 0 },
    recentOrders: f.recent,
  });
}
```
- [ ] **Step 2:** routes/admin.js
```js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as adminController from '../controllers/adminController.js';
const router = Router();
router.get('/stats', requireAuth, requireAdmin, asyncHandler(adminController.getStats));
export default router;
```
- [ ] **Step 3:** app.js에 `import adminRouter` + `app.use('/admin', adminRouter);` (다른 라우터 마운트 옆)
- [ ] **Step 4:** 검증
```
무인증 GET /admin/stats → 401; client 토큰 → 403; admin 토큰 → 200 + 위 shape
```
- [ ] **Step 5:** Commit `feat(admin): 대시보드 통계 엔드포인트`

---

### Task 3: 주문 목록 필터 + 고객 populate

**Files:**
- Modify: `server/src/controllers/orderController.js` (`listAllOrders`)

**Interfaces:**
- Produces: `GET /orders/admin?status=&from=&to=&q=&page=&limit=` → `{page,limit,total,items}`, 각 item에 `user{name,email}` populate.

- [ ] **Step 1:** listAllOrders 교체
```js
export async function listAllOrders(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const filter = {};
  const status = String(req.query.status || '');
  if (['pending','paid','preparing','shipped','delivered','cancelled'].includes(status)) filter.status = status;
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  if (from && !Number.isNaN(from.getTime())) filter.createdAt = { ...(filter.createdAt||{}), $gte: from };
  if (to && !Number.isNaN(to.getTime())) { to.setHours(23,59,59,999); filter.createdAt = { ...(filter.createdAt||{}), $lte: to }; }
  const q = String(req.query.q || '').trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ orderNumber: rx }, { 'shippingAddress.recipient': rx }];
  }
  const [items, total] = await Promise.all([
    Order.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit),
    Order.countDocuments(filter),
  ]);
  res.json({ page, limit, total, items });
}
```
- [ ] **Step 2:** 검증
```
GET /orders/admin?status=paid → paid만; ?q=<받는사람> → 매칭; items[0].user.name 존재
```
- [ ] **Step 3:** Commit `feat(admin): 주문 목록 필터·고객 populate`

---

### Task 4: 어드민 API 클라이언트 + 공용 컴포넌트

**Files:**
- Create: `client/src/lib/admin.js`
- Create: `client/src/components/admin/StatCard.jsx`
- Create: `client/src/components/admin/StatusBadge.jsx`
- Create: `client/src/components/admin/Pagination.jsx`

**Interfaces:**
- Produces: `fetchStats()`, `fetchAdminOrders(params)`, `fetchOrder(id)`, `setOrderStatus(id, body)`; `<StatCard label value sub/>`, `<StatusBadge status/>`, `<Pagination page total limit onPage/>`.

- [ ] **Step 1:** lib/admin.js
```js
import api from './api.js';
export const ORDER_STATUS_LABEL = { pending:'결제대기', paid:'결제완료', preparing:'제작중', shipped:'배송중', delivered:'배송완료', cancelled:'취소' };
export async function fetchStats() { const { data } = await api.get('/admin/stats'); return data; }
export async function fetchAdminOrders(params = {}) { const { data } = await api.get('/orders/admin', { params }); return data; }
export async function fetchOrder(id) { const { data } = await api.get(`/orders/${id}`); return data; }
export async function setOrderStatus(id, body) { const { data } = await api.patch(`/orders/${id}/status`, body); return data; }
```
- [ ] **Step 2:** StatCard.jsx
```jsx
export default function StatCard({ label, value, sub }) {
  return (
    <div className="border border-line p-5">
      <p className="text-[12px] text-mute">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-[12px] text-faint">{sub}</p>}
    </div>
  );
}
```
- [ ] **Step 3:** StatusBadge.jsx
```jsx
import { ORDER_STATUS_LABEL } from '../../lib/admin.js';
export default function StatusBadge({ status }) {
  const muted = status === 'cancelled';
  return <span className={`inline-block border px-2 py-0.5 text-[11px] ${muted ? 'border-line text-faint' : 'border-ink text-ink'}`}>{ORDER_STATUS_LABEL[status] || status}</span>;
}
```
- [ ] **Step 4:** Pagination.jsx
```jsx
export default function Pagination({ page, total, limit, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="mt-6 flex items-center justify-center gap-4 text-sm">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="text-mute hover:text-ink disabled:opacity-30">이전</button>
      <span className="text-[13px]">{page} / {pages}</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="text-mute hover:text-ink disabled:opacity-30">다음</button>
    </div>
  );
}
```
- [ ] **Step 5:** Commit `feat(admin): API 클라이언트 + 공용 컴포넌트`

---

### Task 5: AdminLayout + 중첩 라우트 (기존 Admin.jsx 분해)

**Files:**
- Create: `client/src/components/admin/AdminLayout.jsx`
- Create: `client/src/pages/admin/ProductsAdmin.jsx` (기존 Admin.jsx의 ProductForm+ProductsAdmin 이관)
- Create: `client/src/pages/admin/MembersAdmin.jsx` (기존 UsersAdmin 이관)
- Modify: `client/src/App.jsx` (중첩 라우트로 교체)
- Delete: `client/src/pages/Admin.jsx`

**Interfaces:**
- Consumes: RequireAdmin.
- Produces: `/admin/*` 라우트 트리, `AdminLayout` 사이드바(대시보드/주문/상품/회원 — 리뷰·분석은 후속 Phase에서 추가).

- [ ] **Step 1:** AdminLayout.jsx (사이드바 NavLink + Outlet, 상단바에 사용자명/스토어 복귀)
```jsx
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
const NAV = [
  { to: '/admin', label: '대시보드', end: true },
  { to: '/admin/orders', label: '주문' },
  { to: '/admin/products', label: '상품' },
  { to: '/admin/members', label: '회원' },
];
export default function AdminLayout() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-paper">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <Link to="/" className="text-sm font-extrabold tracking-tight">STACK N' STAK · 관리자</Link>
        <div className="flex items-center gap-4 text-[13px] text-mute">
          <span className="text-ink">{user?.nickname || user?.name}님</span>
          <Link to="/" className="hover:text-ink">스토어로</Link>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1280px] gap-8 px-5 py-8">
        <nav className="hidden w-40 shrink-0 flex-col md:flex">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `border-l-2 px-3 py-2.5 text-sm transition-colors ${isActive ? 'border-ink font-semibold text-ink' : 'border-transparent text-mute hover:text-ink'}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        {/* 모바일 가로 탭 */}
        <div className="min-w-0 flex-1">
          <nav className="mb-6 flex gap-4 overflow-x-auto border-b border-line pb-2 md:hidden">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => `whitespace-nowrap text-sm ${isActive ? 'font-semibold text-ink' : 'text-mute'}`}>{n.label}</NavLink>
            ))}
          </nav>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
```
- [ ] **Step 2:** 기존 `pages/Admin.jsx`에서 `ProductForm`+`ProductsAdmin`(및 상수 TYPES/STATUSES/BADGE_OPTS/emptyForm/toForm/toBody, inputCls/label)를 `pages/admin/ProductsAdmin.jsx`로 그대로 옮기고 `export default ProductsAdmin`. import 경로를 `../../lib/...`로 조정.
- [ ] **Step 3:** 기존 `UsersAdmin`을 `pages/admin/MembersAdmin.jsx`로 옮기고 `export default`. (Phase 1은 읽기전용 유지; 검색/역할토글은 Phase 2)
- [ ] **Step 4:** App.jsx 교체 — 기존 단일 `/admin` 라우트를 중첩으로
```jsx
import AdminLayout from './components/admin/AdminLayout.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import OrdersAdmin from './pages/admin/OrdersAdmin.jsx';
import OrderDetail from './pages/admin/OrderDetail.jsx';
import ProductsAdmin from './pages/admin/ProductsAdmin.jsx';
import MembersAdmin from './pages/admin/MembersAdmin.jsx';
// ...
<Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
  <Route index element={<Dashboard />} />
  <Route path="orders" element={<OrdersAdmin />} />
  <Route path="orders/:id" element={<OrderDetail />} />
  <Route path="products" element={<ProductsAdmin />} />
  <Route path="members" element={<MembersAdmin />} />
</Route>
```
(기존 `import Admin` 및 `<Route path="/admin" ...><Admin/></...>` 제거. Layout 밖에 두어 스토어 Header 없이 렌더 — 즉 `<Route element={<Layout/>}>` 블록 바깥에 배치.)
- [ ] **Step 5:** `pages/Admin.jsx` 삭제. (Dashboard/OrdersAdmin/OrderDetail은 Task 6~8에서 생성 — 임시로 빈 컴포넌트가 없으면 빌드 실패하므로, 이 태스크에서 세 파일의 최소 스텁을 먼저 만든다: `export default function X(){return null}` 후 다음 태스크에서 채움.)
- [ ] **Step 6:** 검증: `npm run build` 성공, `/admin/products` `/admin/members` 렌더(E2E), 비어드민 접근 차단.
- [ ] **Step 7:** Commit `refactor(admin): 중첩 라우트 셸 + 상품/회원 페이지 이관`

---

### Task 6: 대시보드 페이지

**Files:**
- Modify(스텁 대체): `client/src/pages/admin/Dashboard.jsx`

**Interfaces:**
- Consumes: `fetchStats`, `StatCard`, `StatusBadge`, `won`.

- [ ] **Step 1:** Dashboard.jsx
```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchStats } from '../../lib/admin.js';
import { won } from '../../lib/format.js';
import StatCard from '../../components/admin/StatCard.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';

export default function Dashboard() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { fetchStats().then(setS).catch(() => setErr('통계를 불러오지 못했습니다.')); }, []);
  if (err) return <p className="py-12 text-center text-mute">{err}</p>;
  if (!s) return <p className="py-12 text-center text-mute">불러오는 중…</p>;
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="오늘 매출" value={`${won(s.sales.today)}원`} />
        <StatCard label="이번 달 매출" value={`${won(s.sales.month)}원`} />
        <StatCard label="처리 필요 주문" value={`${s.toHandle}건`} sub="결제완료·제작중" />
        <StatCard label="오늘 신규 회원" value={`${s.members.newToday}명`} sub={`총 ${s.members.total}명`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="판매중 상품" value={s.products.active} />
        <StatCard label="품절" value={s.products.soldout} />
        <StatCard label="미공개(draft)" value={s.products.draft} />
        <StatCard label="총 상품" value={s.products.total} />
      </div>
      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">최근 주문</h2>
          <Link to="/admin/orders" className="text-[13px] text-mute hover:text-ink">전체 보기</Link>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {s.recentOrders.map((o) => (
            <Link key={o._id} to={`/admin/orders/${o._id}`} className="flex items-center justify-between py-3 text-sm hover:bg-tint/40">
              <span className="font-medium">{o.orderNumber}</span>
              <span className="text-mute">{o.recipient}</span>
              <span>{won(o.grandTotal)}원</span>
              <StatusBadge status={o.status} />
            </Link>
          ))}
          {s.recentOrders.length === 0 && <p className="py-6 text-center text-mute">주문이 없습니다.</p>}
        </div>
      </div>
    </div>
  );
}
```
- [ ] **Step 2:** 검증: admin 로그인 후 `/admin` E2E — KPI 카드/최근주문 렌더, 0 콘솔 에러.
- [ ] **Step 3:** Commit `feat(admin): 대시보드 페이지`

---

### Task 7: 주문 목록 페이지 (필터·검색·페이지네이션)

**Files:**
- Modify(스텁 대체): `client/src/pages/admin/OrdersAdmin.jsx`

**Interfaces:**
- Consumes: `fetchAdminOrders`, `StatusBadge`, `Pagination`, `ORDER_STATUS_LABEL`, `won`, `useSearchParams`.

- [ ] **Step 1:** OrdersAdmin.jsx — 상태 셀렉트 + 검색 입력 + 표(주문번호/일자/고객/금액/상태) + 행클릭→상세, URL 연동(status,q,page).
```jsx
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchAdminOrders, ORDER_STATUS_LABEL } from '../../lib/admin.js';
import { won } from '../../lib/format.js';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import Pagination from '../../components/admin/Pagination.jsx';

const STATUSES = ['', 'pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled'];

export default function OrdersAdmin() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const q = params.get('q') || '';
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  const [data, setData] = useState({ items: [], total: 0, limit: 30 });
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState(q);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchAdminOrders({ status: status || undefined, q: q || undefined, page })
      .then((d) => active && setData(d))
      .catch(() => active && setData({ items: [], total: 0, limit: 30 }))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [status, q, page]);

  const patch = (obj) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(obj).forEach(([k, v]) => v ? n.set(k, v) : n.delete(k)); if (!('page' in obj)) n.delete('page'); return n; });

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">주문</h1>
      <div className="mt-5 flex flex-wrap gap-2">
        <select value={status} onChange={(e) => patch({ status: e.target.value })} className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none">
          <option value="">전체 상태</option>
          {STATUSES.filter(Boolean).map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); patch({ q: term.trim() }); }} className="flex gap-2">
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="주문번호·받는사람" className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none" />
          <button className="border border-ink px-4 py-2 text-sm hover:bg-tint">검색</button>
        </form>
      </div>
      {loading ? <p className="py-10 text-center text-mute">불러오는 중…</p> : data.items.length === 0 ? <p className="py-10 text-center text-mute">주문이 없습니다.</p> : (
        <div className="mt-5 overflow-x-auto">
          <p className="mb-2 text-[13px] text-mute">총 {data.total}건</p>
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-y border-line text-left text-[12px] text-mute"><th className="py-2 pr-3">주문번호</th><th className="py-2 pr-3">일자</th><th className="py-2 pr-3">고객</th><th className="py-2 pr-3">금액</th><th className="py-2 pr-3">상태</th></tr></thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o._id} className="cursor-pointer border-b border-line hover:bg-tint/40" onClick={() => { window.location.href = `/admin/orders/${o._id}`; }}>
                  <td className="py-3 pr-3 font-medium"><Link to={`/admin/orders/${o._id}`} onClick={(e) => e.stopPropagation()}>{o.orderNumber}</Link></td>
                  <td className="py-3 pr-3 text-[12px] text-mute">{o.createdAt?.slice(0, 10)}</td>
                  <td className="py-3 pr-3">{o.user?.name || o.shippingAddress?.recipient || '-'}</td>
                  <td className="py-3 pr-3">{won(o.amounts.grandTotal)}원</td>
                  <td className="py-3 pr-3"><StatusBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} total={data.total} limit={data.limit} onPage={(p) => patch({ page: String(p) })} />
        </div>
      )}
    </div>
  );
}
```
(주: 행 이동은 `Link`로 충분하나 표 전체 클릭성을 위해 navigate 사용해도 됨 — 구현 시 `useNavigate`로 정리.)
- [ ] **Step 2:** 검증: E2E — 상태 필터/검색/페이지 URL 반영, 행→상세 이동.
- [ ] **Step 3:** Commit `feat(admin): 주문 목록 필터·검색·페이지네이션`

---

### Task 8: 주문 상세 페이지 (상태전이·송장)

**Files:**
- Modify(스텁 대체): `client/src/pages/admin/OrderDetail.jsx`

**Interfaces:**
- Consumes: `fetchOrder`, `setOrderStatus`, `ORDER_STATUS_LABEL`, `StatusBadge`, `won`, `useParams`.

전이 옵션(프론트 표시): 백엔드 TRANSITIONS와 동일 맵을 두고 현재 상태에서 가능한 다음 상태만 버튼/셀렉트로 노출. shipped 선택 시 택배사·송장 입력 필드 표시.

- [ ] **Step 1:** OrderDetail.jsx
```jsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchOrder, setOrderStatus, ORDER_STATUS_LABEL } from '../../lib/admin.js';
import { won } from '../../lib/format.js';
import StatusBadge from '../../components/admin/StatusBadge.jsx';

const NEXT = { pending:['paid','cancelled'], paid:['preparing','cancelled'], preparing:['shipped','cancelled'], shipped:['delivered'], delivered:[], cancelled:[] };

export default function OrderDetail() {
  const { id } = useParams();
  const [o, setO] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');

  const load = () => fetchOrder(id).then((d) => { setO(d); setCourier(d.courier || ''); setTracking(d.trackingNumber || ''); }).catch(() => setErr('주문을 불러오지 못했습니다.'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const change = async (next) => {
    if (next === 'cancelled' && !window.confirm('이 주문을 취소할까요?')) return;
    setBusy(true);
    try {
      const body = { status: next };
      if (next === 'shipped') { if (!tracking.trim()) { window.alert('송장번호를 입력해주세요.'); setBusy(false); return; } body.courier = courier.trim(); body.trackingNumber = tracking.trim(); }
      const updated = await setOrderStatus(id, body);
      setO(updated);
    } catch (e) { window.alert(e.response?.data?.message || '상태 변경 실패'); }
    finally { setBusy(false); }
  };

  if (err) return <p className="py-12 text-center text-mute">{err}</p>;
  if (!o) return <p className="py-12 text-center text-mute">불러오는 중…</p>;
  const nexts = NEXT[o.status] || [];

  return (
    <div className="max-w-3xl">
      <Link to="/admin/orders" className="text-[13px] text-mute hover:text-ink">← 주문 목록</Link>
      <div className="mt-3 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{o.orderNumber}</h1>
        <StatusBadge status={o.status} />
      </div>
      <p className="mt-1 text-[13px] text-mute">{o.createdAt?.slice(0, 16).replace('T', ' ')}</p>

      <section className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="border border-line p-4 text-sm">
          <h2 className="mb-2 font-semibold">고객</h2>
          <p>{o.user?.name || '-'}</p>
          <p className="text-mute">{o.user?.email || '-'}</p>
        </div>
        <div className="border border-line p-4 text-sm">
          <h2 className="mb-2 font-semibold">배송지</h2>
          <p>{o.shippingAddress.recipient} · {o.shippingAddress.phone}</p>
          <p className="text-mute">({o.shippingAddress.zipcode}) {o.shippingAddress.address1} {o.shippingAddress.address2}</p>
          {o.shippingAddress.deliveryMemo && <p className="mt-1 text-[12px] text-faint">메모: {o.shippingAddress.deliveryMemo}</p>}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 font-semibold">주문 상품</h2>
        <ul className="divide-y divide-line border-y border-line text-sm">
          {o.items.map((it, i) => (
            <li key={i} className="flex items-center gap-3 py-3">
              <img src={it.image} alt="" className="h-12 w-12 bg-tint object-cover" />
              <div className="flex-1"><p className="font-medium">{it.name}</p><p className="text-[12px] text-mute">{it.option && `${it.option} · `}수량 {it.qty}</p></div>
              <span>{won(it.price * it.qty)}원</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between text-sm"><span className="text-mute">배송비</span><span>{o.amounts.shippingFee === 0 ? '무료' : `${won(o.amounts.shippingFee)}원`}</span></div>
        <div className="mt-1 flex justify-between font-bold"><span>결제금액</span><span>{won(o.amounts.grandTotal)}원</span></div>
      </section>

      {(o.trackingNumber || o.status === 'shipped' || o.status === 'delivered') && (
        <p className="mt-4 text-[13px] text-mute">송장: {o.courier || '-'} {o.trackingNumber || '-'}</p>
      )}

      {nexts.length > 0 && (
        <section className="mt-8 border-t border-line pt-6">
          <h2 className="mb-3 font-semibold">상태 변경</h2>
          {nexts.includes('shipped') && (
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="택배사" className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none" />
              <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="송장번호 (배송중 전환 시 필수)" className="border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {nexts.map((n) => (
              <button key={n} disabled={busy} onClick={() => change(n)}
                className={`px-5 py-2.5 text-sm font-medium disabled:opacity-50 ${n === 'cancelled' ? 'border border-line text-sale hover:bg-tint' : 'bg-ink text-paper hover:bg-ink/85'}`}>
                {ORDER_STATUS_LABEL[n]}(으)로 변경
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```
- [ ] **Step 2:** 검증: E2E — 상세 렌더(고객/배송지/품목/금액), paid→preparing→shipped(송장 필수)→delivered, cancelled 확인창.
- [ ] **Step 3:** Commit `feat(admin): 주문 상세 + 상태전이·송장`

---

### Task 9: 적대적 리뷰 + 수정 + 배포

- [ ] **Step 1:** 클라 `npm run build` + 백엔드 스모크 재확인.
- [ ] **Step 2:** change-review 워크플로(어드민 Phase 1 변경분: 상태머신·stats·주문필터·AdminLayout·Dashboard·OrdersAdmin·OrderDetail) → 확정 버그만 수정.
- [ ] **Step 3:** 커밋/푸시 → Render·Vercel 재배포 확인(신규 `/admin/stats` 401, 상태머신 400 등).
- [ ] **Step 4:** 메모리 갱신(어드민 Phase 1 완료).

## Self-Review
- **스펙 커버리지:** 대시보드(Task 2,6)·주문상세(Task 8)·주문필터/populate(Task 3,7)·상태머신+송장(Task 1,8)·Order 모델(Task 1)·AdminLayout/중첩라우트(Task 5) — Phase 1 전 항목 매핑됨. 회원/리뷰/상품보강/분석은 Phase 2~4(범위 외).
- **플레이스홀더:** 각 스텝에 실제 코드/명령 포함. Task 5의 스텁은 의도적(빌드 통과용, Task 6~8에서 대체) — 명시함.
- **타입 일치:** `setOrderStatus(id, body)`·`fetchAdminOrders(params)`·`fetchStats()`·`fetchOrder(id)` 명칭이 lib/admin.js(Task4)와 소비처(Task6~8) 일치. StatusBadge/StatCard/Pagination props 일치. 백엔드 TRANSITIONS(Task1)와 프론트 NEXT(Task8) 동일.
