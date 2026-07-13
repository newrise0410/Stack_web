import Stars from '../Stars.jsx';
import WishButton from '../WishButton.jsx';
import BenefitBox from './BenefitBox.jsx';
import { won } from '../../lib/format.js';

function Spec({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-6 py-2 text-[13px]">
      <dt className="w-24 shrink-0 text-mute">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

// 우측 sticky 구매 패널 — 상태는 상위(Product)가 소유하고 props로 받는다.
export default function BuyPanel({
  product,
  rate,
  soldout,
  opt,
  setOpt,
  qty,
  setQty,
  added,
  onAdd,
  onBuyNow,
}) {
  return (
    <div className="md:sticky md:top-[calc(var(--header-h)+1rem)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold tracking-wide text-mute">{product.brand}</p>
        <WishButton slug={product.id} size="text-2xl" />
      </div>
      <h1 className="mt-1.5 text-2xl font-bold tracking-tight sm:text-[26px]">{product.name}</h1>
      <p className="mt-1 text-[14px] text-mute">{product.ko}</p>

      {product.ratingCount > 0 && (
        <div className="mt-2 flex items-center gap-1.5">
          <Stars value={product.ratingAvg} size="text-[13px]" />
          <span className="text-[13px] text-mute">
            {product.ratingAvg.toFixed(1)} ({product.ratingCount})
          </span>
        </div>
      )}
      {soldout && (
        <span className="mt-3 inline-block bg-ink px-2 py-1 text-[11px] font-medium tracking-wide text-paper">
          SOLD OUT
        </span>
      )}

      <div className="mt-5 flex items-baseline gap-2">
        {rate > 0 && <span className="text-2xl font-bold text-sale">{rate}%</span>}
        <span className="text-2xl font-bold">{won(product.price)}원</span>
        {rate > 0 && <span className="text-sm text-faint line-through">{won(product.compareAt)}원</span>}
      </div>

      <BenefitBox price={product.price} />

      <p className="mt-5 text-[14px] leading-relaxed text-ink/75">{product.blurb}</p>

      {product.options?.length > 0 && (
        <div className="mt-7">
          <label className="mb-2 block text-[13px] text-mute">옵션 선택</label>
          <select
            value={opt}
            onChange={(e) => setOpt(e.target.value)}
            className="w-full border border-line bg-paper px-4 py-3 text-sm focus:border-ink focus:outline-none"
          >
            {product.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border border-line px-4 py-3">
        <span className="text-[13px] text-mute">수량</span>
        <div className="flex items-center gap-4">
          <button className="text-lg leading-none text-mute hover:text-ink" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
          <span className="w-6 text-center text-sm">{qty}</span>
          <button className="text-lg leading-none text-mute hover:text-ink" onClick={() => setQty((q) => Math.min(99, q + 1))}>+</button>
        </div>
      </div>

      <div className="mt-5 flex items-baseline justify-between border-t border-line pt-4">
        <span className="text-[13px] text-mute">총 상품금액</span>
        <span className="text-xl font-bold">{won(product.price * qty)}원</span>
      </div>

      {soldout ? (
        <button
          disabled
          className="mt-4 w-full cursor-not-allowed border border-line bg-tint py-4 text-sm font-medium text-mute"
        >
          품절된 상품입니다
        </button>
      ) : (
        <div className="mt-4 flex gap-2.5">
          <button onClick={onAdd} className="flex-1 border border-ink py-4 text-sm font-medium transition-colors hover:bg-tint">
            {added ? '장바구니 담김 ✓' : '장바구니'}
          </button>
          <button onClick={onBuyNow} className="flex-1 bg-ink py-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85">
            바로 구매
          </button>
        </div>
      )}

      <dl className="mt-9 divide-y divide-line border-y border-line">
        <Spec label="소재" value={product.material} />
        <Spec label="크기" value={product.dims} />
        <Spec label="기능" value={product.feature} />
        <Spec label="제작" value={product.made} />
      </dl>
      <p className="mt-4 text-[12px] leading-relaxed text-faint">
        모든 조명은 주문 후 제작됩니다 · 5만원 이상 무료배송 · 단순변심 교환/반품 가능
      </p>
    </div>
  );
}
