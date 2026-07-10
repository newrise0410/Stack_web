import 'dotenv/config';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
// 단일 원본: 클라이언트의 상품 목데이터를 그대로 시드.
import { products as source } from '../../../client/src/data/products.js';

// 클라이언트 형식 → DB 문서 매핑
function toDoc(p) {
  return {
    slug: p.id,
    brand: p.brand,
    name: p.name,
    nameKo: p.ko,
    category: p.category,
    type: p.type,
    description: p.blurb,
    images: [p.image],
    price: p.price,
    compareAtPrice: p.compareAt ?? null,
    badges: p.badge ? [p.badge] : [],
    specs: {
      material: p.material,
      dimensions: p.dims,
      feature: p.feature,
      leadTime: p.made,
    },
    options: p.options,
    status: 'active',
  };
}

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stacknstak';

// deleteMany({})로 상품 전체를 지우므로, 원격(비-로컬) DB엔 명시 확인을 요구한다.
const isLocal = /(127\.0\.0\.1|localhost)/.test(uri);
if (!isLocal && process.env.SEED_CONFIRM !== 'yes') {
  console.error(
    `⚠️  원격 DB에 시드하려 합니다: ${uri.replace(/\/\/[^@]*@/, '//***:***@')}\n` +
      '   이 스크립트는 products 전체를 삭제 후 재삽입합니다. 실행하려면 SEED_CONFIRM=yes 를 붙이세요.',
  );
  process.exit(1);
}

await mongoose.connect(uri);

const docs = source.map(toDoc);
// 원자적 삭제→삽입 대신 slug 기준 upsert로 갱신하면, 중간 실패에도 카탈로그가 비지 않는다(빈 창 제거).
const ops = docs.map((d) => ({
  updateOne: { filter: { slug: d.slug }, update: { $set: d }, upsert: true },
}));
await Product.bulkWrite(ops);
// 소스에서 사라진 상품 정리 — 삭제를 마지막에 배치해 빈 창을 만들지 않는다.
const slugs = docs.map((d) => d.slug);
const removed = await Product.deleteMany({ slug: { $nin: slugs } });

console.log(`Seeded ${docs.length} products (removed ${removed.deletedCount} stale).`);
await mongoose.disconnect();
