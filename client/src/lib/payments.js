import api from './api.js';

const IMP_CODE = import.meta.env.VITE_PORTONE_IMP_CODE;
const CHANNEL_KEY = import.meta.env.VITE_PORTONE_CHANNEL_KEY;

// 결제 컨텍스트 — 모바일 리다이렉트(페이지 이탈)에서도 살아남도록 sessionStorage에 보관
const PAY_CTX_KEY = 'sns_pay_ctx';

export function savePayContext(ctx) {
  sessionStorage.setItem(PAY_CTX_KEY, JSON.stringify(ctx));
}
export function loadPayContext() {
  try {
    return JSON.parse(sessionStorage.getItem(PAY_CTX_KEY) || 'null');
  } catch {
    return null;
  }
}
export function clearPayContext() {
  sessionStorage.removeItem(PAY_CTX_KEY);
}

// 결제창 콜백/리다이렉트 후 서버 검증 — 서버가 포트원 재조회로 최종 판정한다.
export async function completePayment(impUid, merchantUid = null) {
  // merchantUid는 폴백 조회 힌트(선택) — 서버는 포트원 응답 imp_uid 일치를 재검증한다.
  const { data } = await api.post('/payments/complete', { impUid, merchantUid: merchantUid || undefined });
  return data;
}

// IMP.request_pay Promise 래퍼. checkout: 서버 createOrder 응답의 checkout DTO.
export function requestPortonePay({ checkout, buyer }) {
  return new Promise((resolve, reject) => {
    const IMP = window.IMP;
    if (!IMP || !IMP_CODE) {
      reject(new Error('결제 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.'));
      return;
    }
    IMP.init(IMP_CODE);
    IMP.request_pay(
      {
        ...(CHANNEL_KEY ? { channelKey: CHANNEL_KEY } : { pg: 'html5_inicis' }),
        pay_method: 'card',
        merchant_uid: checkout.orderNumber,
        name: checkout.orderName,
        amount: checkout.amount,
        buyer_email: buyer.email || '',
        buyer_name: buyer.name || '',
        buyer_tel: buyer.tel || '',
        buyer_addr: buyer.addr || '',
        buyer_postcode: buyer.postcode || '',
        m_redirect_url: `${window.location.origin}/checkout/complete`,
      },
      (rsp) => {
        if (rsp.success) resolve(rsp);
        else reject(Object.assign(new Error(rsp.error_msg || '결제가 완료되지 않았습니다.'), { rsp }));
      },
    );
  });
}
