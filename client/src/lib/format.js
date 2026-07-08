// KRW formatting: 48000 -> "48,000"
export function won(n) {
  return n.toLocaleString('ko-KR');
}

export function discountRate(price, compareAt) {
  if (!compareAt || compareAt <= price) return 0;
  return Math.round(((compareAt - price) / compareAt) * 100);
}
