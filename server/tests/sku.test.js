import { describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import Product from '../src/models/Product.js';
import Counter from '../src/models/Counter.js';
import { nextSku, formatSku, reconcileCounters, SKU_RE } from '../src/services/skuService.js';
import { backfillProductSkus } from '../src/seed/backfillSkus.js';
import { createTestUser, authHeader } from './helpers.js';

const app = createApp();
const adminHeader = async () => authHeader(await createTestUser({ role: 'admin' }));

const productBody = (over = {}) => ({
  slug: `p-${Math.random().toString(36).slice(2, 8)}`,
  name: 'LAMP', nameKo: '램프', type: 'Tech', price: 10000, ...over,
});

describe('skuService — 발급기', () => {
  it('동시 발급 20회가 서로 다른 20개를 낸다 (원자성)', async () => {
    const skus = await Promise.all(Array.from({ length: 20 }, () => nextSku('Tech')));
    expect(new Set(skus).size).toBe(20); // ★ 중복 없음
    skus.forEach((s) => expect(SKU_RE.test(s)).toBe(true));
  });

  it('형식은 SNS-TEC-001, 999→1000 자릿수 증가', async () => {
    expect(formatSku('Tech', 1)).toBe('SNS-TEC-001');
    expect(formatSku('Clock', 42)).toBe('SNS-CLK-042');
    expect(formatSku('Table', 1000)).toBe('SNS-TBL-1000');
  });

  it('미지 타입은 throw', async () => {
    await expect(nextSku('Nonsense')).rejects.toThrow();
  });

  it('reconcileCounters는 이미 쓰인 최대치까지 올리기만 한다', async () => {
    await Product.create(productBody({ sku: 'SNS-TEC-050', type: 'Tech' }));
    await reconcileCounters();
    expect((await nextSku('Tech')).endsWith('-051')).toBe(true); // 50 다음
    // 낮은 값으로는 안 내려감
    await Counter.updateOne({ _id: 'sku:Tech' }, { $set: { seq: 100 } });
    await reconcileCounters(); // 최대 sku가 51이어도 seq는 100 유지
    expect((await Counter.findById('sku:Tech')).seq).toBe(100);
  });
});

describe('POST /products — SKU 서버 생성', () => {
  it('상품 생성 시 타입별 SKU를 자동 부여한다', async () => {
    const h = await adminHeader();
    const r1 = await request(app).post('/products').set(h).send(productBody({ type: 'Tech' }));
    const r2 = await request(app).post('/products').set(h).send(productBody({ type: 'Clock' }));
    expect(r1.body.sku).toMatch(/^SNS-TEC-\d{3}$/);
    expect(r2.body.sku).toMatch(/^SNS-CLK-\d{3}$/);
  });

  it('클라가 sku를 보내도 무시된다 (서버 생성 전용)', async () => {
    const h = await adminHeader();
    const r = await request(app).post('/products').set(h).send(productBody({ sku: 'SNS-XXX-999' }));
    expect(r.body.sku).not.toBe('SNS-XXX-999');
    expect(r.body.sku).toMatch(/^SNS-TEC-\d{3}$/);
  });

  it('PATCH로 sku를 바꿀 수 없다 (불변)', async () => {
    const h = await adminHeader();
    const created = (await request(app).post('/products').set(h).send(productBody())).body;
    await request(app).patch(`/products/${created.slug}`).set(h).send({ sku: 'SNS-XXX-001', price: 20000 });
    const after = await Product.findOne({ slug: created.slug });
    expect(after.sku).toBe(created.sku); // 안 바뀜
    expect(after.price).toBe(20000); // 다른 필드는 반영
  });

  it('잘못된 타입은 400, 중복 slug는 명확한 409', async () => {
    const h = await adminHeader();
    expect((await request(app).post('/products').set(h).send(productBody({ type: 'Bad' }))).status).toBe(400);
    const body = productBody();
    await request(app).post('/products').set(h).send(body);
    const dup = await request(app).post('/products').set(h).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.message).toContain('slug');
  });
});

describe('backfillProductSkus — 소급 부여', () => {
  it('훅을 우회한 원시 삽입(sku 없음)에 전원 발급하고, 재실행해도 불변·재사용 없음', async () => {
    // bulkWrite/insertMany는 pre save 훅을 안 타므로 sku 없이 들어간다 — 시드 경로 재현.
    const raw = Array.from({ length: 5 }, (_, i) => ({
      slug: `raw-${i}`, name: `R${i}`, type: i % 2 ? 'Clock' : 'Tech', price: 1000,
    }));
    await mongoose.connection.db.collection('products').insertMany(raw);

    const n1 = await backfillProductSkus();
    expect(n1).toBe(5);
    const all = await Product.find({ slug: /^raw-/ });
    expect(all.every((p) => SKU_RE.test(p.sku))).toBe(true);
    expect(new Set(all.map((p) => p.sku)).size).toBe(5); // 전부 유일

    // 멱등 — 재실행은 0건, 기존 sku 불변
    const before = Object.fromEntries(all.map((p) => [p.slug, p.sku]));
    const n2 = await backfillProductSkus();
    expect(n2).toBe(0);
    const again = await Product.find({ slug: /^raw-/ });
    again.forEach((p) => expect(p.sku).toBe(before[p.slug]));

    // 카운터를 지우고 재실행해도 재사용 없음(reconcile이 최대치 복원)
    await Counter.deleteMany({});
    await Product.collection.insertOne({ slug: 'raw-new', name: 'N', type: 'Tech', price: 1000 });
    await backfillProductSkus();
    const newOne = await Product.findOne({ slug: 'raw-new' });
    const existing = all.filter((p) => p.type === 'Tech').map((p) => p.sku);
    expect(existing).not.toContain(newOne.sku); // 기존 Tech SKU와 충돌 안 함
  });

  it('sku:null이 명시된 문서도 backfill이 채운다 (술어 일치 — 카운터 무한소모 방지)', async () => {
    // 원시 삽입으로 sku:null 박기 — $exists:false 가드였다면 영영 미할당됐을 케이스.
    await Product.collection.insertOne({ slug: 'nullsku', name: 'X', type: 'Clock', price: 1000, sku: null });
    const n = await backfillProductSkus();
    expect(n).toBe(1);
    const after = await Product.findOne({ slug: 'nullsku' });
    expect(after.sku).toMatch(/^SNS-CLK-\d{3}$/); // null이었지만 채워짐
    // 재실행은 0건(더는 대상 아님)
    expect(await backfillProductSkus()).toBe(0);
  });
});

describe('주문 스냅샷', () => {
  it('주문 항목에 SKU가 스냅샷된다', async () => {
    const h = await adminHeader();
    const created = (await request(app).post('/products').set(h).send(productBody({ slug: 'snap-lamp', price: 10000 }))).body;
    const { default: Order } = await import('../src/models/Order.js');
    const buyer = await createTestUser();
    const o = await Order.create({
      user: buyer._id, orderNumber: `20260718-${Math.floor(100000 + Math.random() * 899999)}`,
      status: 'paid',
      items: [{ product: created._id, slug: 'snap-lamp', sku: created.sku, name: 'LAMP', price: 10000, qty: 1 }],
      shippingAddress: { recipient: '홍', phone: '010', zipcode: '06236', address1: '서울' },
      amounts: { itemsTotal: 10000, shippingFee: 0, grandTotal: 10000 },
    });
    expect(o.items[0].sku).toBe(created.sku);
  });
});
