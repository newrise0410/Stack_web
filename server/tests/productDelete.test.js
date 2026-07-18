import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import Product from '../src/models/Product.js';
import { createTestUser, authHeader } from './helpers.js';

const app = createApp();

function mkProduct(over = {}) {
  return Product.create({
    slug: `lamp-${Math.random().toString(36).slice(2, 8)}`,
    name: 'TEST LAMP', nameKo: '테스트 램프', type: 'Table', price: 10000,
    images: ['https://res.cloudinary.com/x/image/upload/stacknstak/products/a.png'],
    status: 'active',
    ...over,
  });
}

async function adminHeader() {
  return authHeader(await createTestUser({ role: 'admin' }));
}

describe('DELETE /products/:slug — 소프트 삭제(보관)', () => {
  it('하드 삭제가 아니라 archived로 전환한다 — 문서·이미지 보존', async () => {
    const h = await adminHeader();
    const p = await mkProduct();
    const res = await request(app).delete(`/products/${p.slug}`).set(h);
    expect(res.status).toBe(204);

    const after = await Product.findOne({ slug: p.slug });
    expect(after).not.toBeNull(); // ★ 문서가 지워지지 않음
    expect(after.status).toBe('archived');
    expect(after.images).toHaveLength(1); // ★ Cloudinary URL 보존
  });

  it('보관된 상품은 공개 목록·상세에서 숨겨진다', async () => {
    const h = await adminHeader();
    const p = await mkProduct();
    await request(app).delete(`/products/${p.slug}`).set(h);

    const list = await request(app).get('/products');
    expect(list.body.items.some((x) => x.slug === p.slug)).toBe(false);
    const detail = await request(app).get(`/products/${p.slug}`);
    expect(detail.status).toBe(404);
  });

  it('관리자는 보관 상품을 status 필터로 보고 되돌릴 수 있다', async () => {
    const h = await adminHeader();
    const p = await mkProduct();
    await request(app).delete(`/products/${p.slug}`).set(h);

    const archived = await request(app).get('/products/admin?status=archived').set(h);
    expect(archived.body.items.some((x) => x.slug === p.slug)).toBe(true);

    // 되돌리기 — status를 active로
    const restore = await request(app).patch(`/products/${p.slug}`).set(h).send({ status: 'active' });
    expect(restore.status).toBe(200);
    const back = await Product.findOne({ slug: p.slug });
    expect(back.status).toBe('active');
  });

  it('없는 상품은 404', async () => {
    const h = await adminHeader();
    const res = await request(app).delete('/products/nope-nope').set(h);
    expect(res.status).toBe(404);
  });

  it('비관리자는 거부된다', async () => {
    const p = await mkProduct();
    const res = await request(app).delete(`/products/${p.slug}`).set(authHeader(await createTestUser()));
    expect(res.status).toBe(403);
    expect(await Product.findOne({ slug: p.slug })).not.toBeNull(); // 안 건드림
  });
});
