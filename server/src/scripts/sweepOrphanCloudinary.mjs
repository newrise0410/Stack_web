import 'dotenv/config';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import { cloudinary, isConfigured, UPLOAD_FOLDER } from '../config/cloudinary.js';
import { publicIdFromUrl } from '../utils/cloudinaryUrl.js';

// UPLOAD_FOLDER의 Cloudinary 리소스 중 어떤 상품도 참조하지 않는 고아를 청소한다.
// delete/update 훅(cleanupOrphanImages)의 안전망이자, '업로드했지만 저장 안 한' 고아까지 잡는다.
// 기본 dry-run — 실제 삭제는 SWEEP_CONFIRM=yes 필요(seed/migrate와 동일한 명시 확인 패턴).
if (!isConfigured()) {
  console.error('Cloudinary 환경변수(CLOUDINARY_URL 또는 3-part)가 필요합니다.');
  process.exit(1);
}
const DRY = process.env.SWEEP_CONFIRM !== 'yes';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stacknstak';
await mongoose.connect(uri);

// 1) DB가 참조하는 모든 public_id 수집 — 상품 images + 과거 주문의 항목 스냅샷 image
const referenced = new Set();
const products = await Product.find({}, { images: 1 });
for (const p of products) {
  for (const url of p.images || []) {
    const id = publicIdFromUrl(url);
    if (id) referenced.add(id);
  }
}
// 주문은 주문시점 이미지 URL을 고정 저장하므로 상품에서 빠졌어도 보호해야 한다.
const orders = await Order.find({}, { 'items.image': 1 });
for (const o of orders) {
  for (const it of o.items || []) {
    const id = publicIdFromUrl(it.image);
    if (id) referenced.add(id);
  }
}

// 2) UPLOAD_FOLDER의 모든 리소스 나열(페이지네이션)
const all = [];
let nextCursor;
do {
  const res = await cloudinary.api.resources({
    type: 'upload',
    prefix: `${UPLOAD_FOLDER}/`,
    max_results: 500,
    next_cursor: nextCursor,
  });
  all.push(...res.resources.map((r) => r.public_id));
  nextCursor = res.next_cursor;
} while (nextCursor);

// 3) 미참조 = 고아
const orphans = all.filter((id) => !referenced.has(id));
console.log(`리소스 ${all.length} / DB 참조 ${referenced.size} / 고아 ${orphans.length}${DRY ? '  (dry-run)' : ''}`);
for (const id of orphans) console.log('  고아:', id);

let destroyed = 0;
if (!DRY) {
  for (const id of orphans) {
    try {
      await cloudinary.uploader.destroy(id, { resource_type: 'image', invalidate: true });
      destroyed += 1;
      console.log('  destroyed:', id);
    } catch (e) {
      console.error('  삭제 실패:', id, e?.message);
    }
  }
}

await mongoose.disconnect();
console.log(DRY
  ? `\ndry-run 완료 — 실제 삭제하려면 SWEEP_CONFIRM=yes 로 재실행`
  : `\nsweep 완료 — ${destroyed}/${orphans.length} 삭제`);
