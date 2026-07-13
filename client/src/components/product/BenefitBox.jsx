import { useAuth } from '../../lib/auth.jsx';
import { won } from '../../lib/format.js';

// 서버 로직과 동기화된 값(server/src/services/pointService.js · orderController.js).
const EARN_RATE = 0.03; // 결제액 3% 적립
const FREE_SHIPPING_THRESHOLD = 50000; // 5만원 이상 무료배송
const SIGNUP_BONUS = 3000; // 가입 축하 적립금

function Row({ label, children }) {
  return (
    <div className="flex gap-4 text-[13px]">
      <dt className="w-14 shrink-0 text-mute">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

// 가격 아래 혜택 요약 — 적립금 · 배송 · 쿠폰. 전부 실제 로직 기반.
export default function BenefitBox({ price }) {
  const { user } = useAuth();
  const earn = Math.floor(price * EARN_RATE);
  const freeShipping = price >= FREE_SHIPPING_THRESHOLD;

  return (
    <dl className="mt-5 space-y-2.5 bg-tint px-4 py-4">
      <Row label="적립금">
        구매 시 <span className="font-semibold">{won(earn)}원</span>
        <span className="text-mute"> ({Math.round(EARN_RATE * 100)}%)</span>
      </Row>
      <Row label="배송">
        {freeShipping ? (
          <span className="font-semibold">무료배송</span>
        ) : (
          <>배송비 3,000원 · 5만원 이상 무료</>
        )}
      </Row>
      <Row label="쿠폰">
        {user ? (
          '회원 전용 쿠폰 적용 가능'
        ) : (
          <>
            지금 가입하면 <span className="font-semibold">{won(SIGNUP_BONUS)}원</span> 적립
          </>
        )}
      </Row>
    </dl>
  );
}
