import Product from '../models/Product.js';
import { nextSku, reconcileCounters } from '../services/skuService.js';

// sku 없는 상품에 SKU를 발급한다. 시드 말미와 backfill 스크립트가 공유하는 멱등 함수.
// 시드가 새 상품을 insert하는 경우와 '기존 79종 소급'은 같은 연산 — "sku 없는 상품을 찾아 발급".
//
// $setOnInsert로 넣지 않는 이유: ops 배열을 만들 때 eager 호출돼, update-only 케이스에도
// 카운터를 태워 순번에 구멍이 난다. 시드는 upsert 동기화라 반복 실행되므로 특히 위험하다.
export async function backfillProductSkus() {
  await reconcileCounters(); // 반드시 발급 전 — 카운터를 이미 쓰인 최대치로 올려 충돌 방지
  // createdAt→_id 순: ObjectId가 시간순이라 삽입 순서(≈소스 파일 순서)를 복원한다.
  const targets = await Product.find({ sku: { $not: { $type: 'string' } } })
    .sort({ createdAt: 1, _id: 1 })
    .select('_id type');
  let assigned = 0;
  for (const p of targets) {
    const sku = await nextSku(p.type);
    // 조건부 $set — 중간 실패·동시 실행에도 중복 없이 나머지만 채운다(패자는 0건 매치).
    // ⚠️ 가드 술어는 targets 조건과 **정확히 같아야** 한다. $exists:false로 좁히면
    //    sku:null 문서는 targets엔 잡히지만 여기서 0건 매치라 영영 미할당 + 매 실행 카운터만 태운다.
    const r = await Product.updateOne({ _id: p._id, sku: { $not: { $type: 'string' } } }, { $set: { sku } });
    if (r.modifiedCount) assigned += 1;
  }
  return assigned;
}
