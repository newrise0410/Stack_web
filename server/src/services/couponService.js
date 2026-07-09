// 쿠폰 검증 + 할인 계산 (서버 권위). 금액은 정수 KRW.

const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;

// 유효성 검사. 통과하면 null, 실패하면 사용자용 사유 메시지 반환.
export function validateCoupon(coupon, itemsTotal, now = new Date()) {
  if (!coupon) return '유효하지 않은 쿠폰입니다.';
  if (!coupon.active) return '사용할 수 없는 쿠폰입니다.';
  if (coupon.expiresAt && now > new Date(coupon.expiresAt)) return '만료된 쿠폰입니다.';
  if (itemsTotal < (coupon.minOrderAmount || 0)) {
    return `최소 주문금액 ${won(coupon.minOrderAmount)} 이상부터 사용할 수 있습니다.`;
  }
  return null;
}

// 할인 계산. { itemDiscount(상품할인), shippingFee(적용 후 배송비), discountTotal(총 혜택) }
export function computeCoupon(coupon, itemsTotal, baseShipping) {
  let itemDiscount = 0;
  let shippingFee = baseShipping;

  if (coupon.discountType === 'fixed') {
    itemDiscount = Math.min(Math.max(0, coupon.discountValue), itemsTotal);
  } else if (coupon.discountType === 'percent') {
    const raw = Math.round((itemsTotal * Math.max(0, coupon.discountValue)) / 100);
    itemDiscount = coupon.maxDiscount > 0 ? Math.min(raw, coupon.maxDiscount) : raw;
    itemDiscount = Math.min(itemDiscount, itemsTotal);
  } else if (coupon.discountType === 'free_shipping') {
    shippingFee = 0;
  }

  const shippingDiscount = baseShipping - shippingFee;
  return { itemDiscount, shippingFee, discountTotal: itemDiscount + shippingDiscount };
}
