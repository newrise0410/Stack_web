import { won } from '../../lib/format.js';

// 모바일 전용 하단 고정 구매바. 데스크톱은 sticky 패널이 대체하므로 md:hidden.
export default function MobileBuyBar({ price, qty, soldout, added, onAdd, onBuyNow }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper px-4 py-3 md:hidden">
      {soldout ? (
        <button
          disabled
          className="w-full cursor-not-allowed bg-tint py-3.5 text-sm font-medium text-mute"
        >
          품절된 상품입니다
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <p className="text-[11px] text-mute">총 금액</p>
            <p className="text-base font-bold leading-tight">{won(price * qty)}원</p>
          </div>
          <button onClick={onAdd} className="flex-1 border border-ink py-3.5 text-sm font-medium">
            {added ? '담김 ✓' : '장바구니'}
          </button>
          <button onClick={onBuyNow} className="flex-1 bg-ink py-3.5 text-sm font-medium text-paper">
            바로 구매
          </button>
        </div>
      )}
    </div>
  );
}
