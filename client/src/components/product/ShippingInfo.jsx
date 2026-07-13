// 배송·교환·반품 안내. 스터디 스코프의 고정 정책 문구.
const ROWS = [
  ['배송 방법', '택배 (주문 후 국내 스튜디오 제작)'],
  ['배송 비용', '3,000원 · 5만원 이상 구매 시 무료'],
  ['배송 기간', '제작 2–4일 + 배송 1–2일 (영업일 기준)'],
  ['교환·반품', '수령 후 7일 이내 · 단순변심 왕복 배송비 고객 부담'],
  ['제외 사항', '주문 제작 특성상 사용·훼손 시 교환/반품 불가'],
];

export default function ShippingInfo() {
  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">배송·반품 안내</h2>
      <dl className="mt-6 divide-y divide-line border-y border-line">
        {ROWS.map(([label, value]) => (
          <div key={label} className="flex gap-6 py-4 text-[14px]">
            <dt className="w-24 shrink-0 text-mute">{label}</dt>
            <dd className="leading-relaxed text-ink/80">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
