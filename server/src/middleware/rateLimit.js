// 의존성 없는 in-memory 슬라이딩 윈도우 rate limiter.
// 프로세스 재시작 시 초기화되고 인스턴스 간 공유되지 않는다 — 단일 인스턴스(무료 티어) 스코프엔 충분.
// key(req)로 버킷을 나눈다(기본 IP; 인증 라우트는 사용자 id 권장).
export function rateLimit({ windowMs, max, key = (req) => req.ip, message } = {}) {
  const hits = new Map(); // key -> number[] (요청 타임스탬프)
  return function limiter(req, res, next) {
    const now = Date.now();
    const k = key(req);
    const recent = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      const retry = Math.ceil((windowMs - (now - recent[0])) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ message: message || '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
    }
    recent.push(now);
    hits.set(k, recent);
    // 메모리 누수 방지: 버킷이 많아지면 만료된 항목을 청소
    if (hits.size > 500) {
      for (const [kk, arr] of hits) {
        if (arr.every((t) => now - t >= windowMs)) hits.delete(kk);
      }
    }
    return next();
  };
}
