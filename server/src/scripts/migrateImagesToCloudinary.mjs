import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import { cloudinary, isConfigured, UPLOAD_FOLDER } from '../config/cloudinary.js';

// 안전장치: Atlas 등 원격 DB를 실수로 건드리지 않도록 명시 확인을 요구한다(seed와 동일 패턴).
if (process.env.MIGRATE_CONFIRM !== 'yes') {
  console.error('안전장치: MIGRATE_CONFIRM=yes 를 설정해야 실행됩니다.');
  process.exit(1);
}
if (!isConfigured()) {
  console.error('Cloudinary 환경변수(CLOUDINARY_URL 또는 CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)가 필요합니다.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../../client/public'); // repo/client/public
const LOCAL_PREFIX = '/products/lamp/';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stacknstak';
await mongoose.connect(uri);

const products = await Product.find({});
let changedProducts = 0;
let uploaded = 0;
let skippedMissing = 0; // 로컬 파일 없음
let uploadFailed = 0; // Cloudinary 업로드 예외
let saveFailed = 0; // DB 저장 예외

for (const p of products) {
  let dirty = false;
  const next = [];
  for (const url of p.images || []) {
    if (!url.startsWith(LOCAL_PREFIX)) { next.push(url); continue; } // 이미 Cloudinary/외부 URL
    const localPath = path.join(PUBLIC_DIR, url);
    if (!fs.existsSync(localPath)) {
      console.warn('파일 없음, 건너뜀:', url);
      skippedMissing += 1; next.push(url); continue;
    }
    const base = path.basename(url, path.extname(url)); // 확장자 제거 → 멱등 public_id
    try {
      const r = await cloudinary.uploader.upload(localPath, {
        folder: UPLOAD_FOLDER, public_id: base, overwrite: true,
      });
      next.push(r.secure_url); uploaded += 1; dirty = true;
    } catch (e) {
      console.error('업로드 실패:', url, e.message);
      uploadFailed += 1; next.push(url);
    }
  }
  if (dirty) {
    try {
      p.images = next; await p.save(); changedProducts += 1;
    } catch (e) {
      console.error('저장 실패:', p.slug, e.message);
      saveFailed += 1;
    }
  }
}

console.log(`완료 — 변경상품 ${changedProducts} / 업로드 ${uploaded} / 파일없음 ${skippedMissing} / 업로드실패 ${uploadFailed} / 저장실패 ${saveFailed}`);
await mongoose.disconnect();
