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
await Product.deleteMany({});
await Product.insertMany(docs);

console.log(`Seeded ${docs.length} products.`);
await mongoose.disconnect();
