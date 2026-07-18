import Counter from '../models/Counter.js';
import Product from '../models/Product.js';
import { TYPE_CODE } from '../models/Product.js';

export const SKU_RE = /^SNS-([A-Z]{3})-(\d+)$/;

export const formatSku = (type, seq) => `SNS-${TYPE_CODE[type]}-${String(seq).padStart(3, '0')}`;

// SKU 문자열에서 순번을 뽑는다. 형식이 아니면 NaN.
export function skuSeq(sku) {
  const m = SKU_RE.exec(sku || '');
  return m ? parseInt(m[2], 10) : NaN;
}

// 타입별 순번 원자 발급. $inc는 문서 단위 원자라 트랜잭션 불필요.
// genOrderNumber의 재시도 루프를 따라하지 않는다 — 그건 난수라 확률적으로 충돌하지만,
// 카운터는 단조증가라 구조적으로 충돌하지 않는다. 여기서 11000이 뜨면 발급기를 우회한 것이니
// 재시도로 덮지 말고 터져야 한다.
// ⚠️ 발급 후 상품 생성이 실패하면 번호에 구멍이 생긴다 — 재사용 방지 > 연속성(의도된 트레이드오프).
export async function nextSku(type) {
  if (!TYPE_CODE[type]) throw new Error(`Unknown product type: ${type}`);
  const c = await Counter.findOneAndUpdate(
    { _id: `sku:${type}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return formatSku(type, c.seq);
}

// 이미 쓰인 최대 번호까지 카운터를 끌어올린다. counters가 유실/초기화된 DB에 backfill을 돌리면
// nextSku가 1부터 재발급해 기존 SKU와 충돌하므로, 발급 전에 반드시 호출한다.
// $max라 내려가지 않아 재실행·동시실행에 안전.
// ⚠️ max는 JS로 계산한다 — 사전순 정렬은 'SNS-TBL-1000' < 'SNS-TBL-999'라 999를 넘는 순간 깨진다.
export async function reconcileCounters() {
  const rows = await Product.find({ sku: { $type: 'string' } }).select('type sku');
  const maxByType = {};
  for (const p of rows) {
    const n = skuSeq(p.sku);
    if (!Number.isNaN(n)) maxByType[p.type] = Math.max(maxByType[p.type] || 0, n);
  }
  for (const [type, max] of Object.entries(maxByType)) {
    await Counter.updateOne({ _id: `sku:${type}` }, { $max: { seq: max } }, { upsert: true });
  }
}
