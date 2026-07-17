// 포트원(아임포트) v1 REST 클라이언트.
// 규약: Authorization=access_token 원문, 응답 envelope {code,message,response}에서 code===0만 성공.
// 에러는 이 경계에서 정제해 던진다 — imp_secret·토큰·요청 config가 로그로 새지 않게.
const BASE = 'https://api.iamport.kr';
const TIMEOUT_MS = 10000;

// 확정 실패(포트원이 명시적으로 거절) — 호출부는 실패로 처리해도 된다.
export class PortoneError extends Error {
  constructor(message, { portoneCode = null } = {}) {
    super(message);
    this.name = 'PortoneError';
    this.status = 502;
    this.portoneCode = portoneCode;
  }
}

// 결과 불명(타임아웃·5xx·네트워크) — 성공/실패를 알 수 없으므로 상태를 바꾸지 말고 재조회로 수렴할 것.
export class PortoneUnknownError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PortoneUnknownError';
    this.status = 502;
  }
}

let tokenCache = null; // { token, expiresAtMs }

export function _resetTokenCache() {
  tokenCache = null;
}

export function isConfigured() {
  return Boolean(process.env.PORTONE_IMP_KEY && process.env.PORTONE_IMP_SECRET);
}

async function rawFetch(path, { method = 'GET', body = null, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = await getToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new PortoneUnknownError(`포트원 요청 실패(${path}): ${e?.name === 'AbortError' ? '타임아웃' : '네트워크 오류'}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 500) throw new PortoneUnknownError(`포트원 서버 오류(${res.status}, ${path})`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new PortoneUnknownError(`포트원 응답 파싱 실패(${path})`);
  }
  if (data.code !== 0) throw new PortoneError(data.message || `포트원 오류(code ${data.code})`, { portoneCode: data.code });
  return data.response;
}

async function getToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAtMs) return tokenCache.token;
  const r = await rawFetch('/users/getToken', {
    method: 'POST',
    auth: false,
    body: { imp_key: process.env.PORTONE_IMP_KEY, imp_secret: process.env.PORTONE_IMP_SECRET },
  });
  // expired_at은 Unix seconds — 60초 여유를 두고 갱신
  tokenCache = { token: r.access_token, expiresAtMs: (r.expired_at - 60) * 1000 };
  return tokenCache.token;
}

export async function getPayment(impUid) {
  return rawFetch(`/payments/${encodeURIComponent(impUid)}`);
}

// merchant_uid로 최신 결제 조회. "결제 없음"은 정상 케이스라 null로 반환.
export async function findPayment(merchantUid) {
  try {
    return await rawFetch(`/payments/find/${encodeURIComponent(merchantUid)}`);
  } catch (e) {
    if (e instanceof PortoneError) return null;
    throw e;
  }
}

export async function prepare(merchantUid, amount) {
  await rawFetch('/payments/prepare', { method: 'POST', body: { merchant_uid: merchantUid, amount } });
}

export async function getPrepared(merchantUid) {
  try {
    return await rawFetch(`/payments/prepare/${encodeURIComponent(merchantUid)}`);
  } catch (e) {
    if (e instanceof PortoneError) return null;
    throw e;
  }
}

export async function cancel({ impUid, amount, checksum, reason = '' }) {
  return rawFetch('/payments/cancel', {
    method: 'POST',
    body: { imp_uid: impUid, amount, checksum, reason },
  });
}
