import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCart } from '../lib/cart.jsx';
import { completePayment, loadPayContext, clearPayContext } from '../lib/payments.js';
import { cancelOrder } from '../lib/orders.js';
import { won } from '../lib/format.js';

// 모바일 결제(m_redirect_url) 복귀 지점. 데스크톱 새로고침 유실 복구도 겸한다.
// 쿼리의 imp_success는 승인 근거가 아니다 — 서버 검증(completePayment)만 믿는다.
export default function CheckoutComplete() {
  const [params] = useSearchParams();
  const { remove } = useCart();
  const [phase, setPhase] = useState('checking'); // checking | done | failed | delayed
  const [order, setOrder] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const impUid = params.get('imp_uid');
    const errorMsg = params.get('error_msg');
    const ctx = loadPayContext();

    async function run() {
      if (impUid) {
        try {
          const d = await completePayment(impUid);
          // 202(ready) 등은 order 없이 2xx로 온다 — outcome이 확정(paid/already_paid)일 때만 완료 처리.
          if (d?.order && ['paid', 'already_paid'].includes(d.outcome)) {
            (ctx?.lines || []).forEach((l) => remove(l.id, l.option));
            clearPayContext();
            setOrder(d.order);
            setPhase('done');
            return;
          }
          // 아직 서버가 결제를 확정하지 않음 — 컨텍스트를 지우지 않고 재확인 유도.
          setMessage(d?.message || '결제 확인이 지연되고 있습니다. 잠시 후 마이페이지에서 주문 상태를 확인해주세요.');
          setPhase('delayed');
          return;
        } catch (e) {
          if (!e.response) {
            // 네트워크 유실 — 취소 금지, 재확인 안내
            setMessage('결제 확인이 지연되고 있습니다. 잠시 후 마이페이지에서 주문 상태를 확인해주세요.');
            setPhase('delayed');
            return;
          }
          if (e.response.status !== 400) {
            // 서버 오류(5xx 등) — 실패로 단정하지 않는다. 취소하지 않고 재확인 안내.
            setMessage(e.response.data?.message || '결제 확인이 지연되고 있습니다. 잠시 후 마이페이지에서 주문 상태를 확인해주세요.');
            setPhase('delayed');
            return;
          }
          // 400 — 서버가 실패로 판정. 아래 취소 정리로.
        }
      }
      // 결제 실패/취소 — pending 주문 정리(서버가 결제 존재를 선확인)
      if (ctx?.orderId) {
        try {
          const cancelled = await cancelOrder(ctx.orderId);
          if (cancelled?.status === 'paid') {
            (ctx?.lines || []).forEach((l) => remove(l.id, l.option));
            clearPayContext();
            setOrder(cancelled);
            setPhase('done');
            return;
          }
          clearPayContext();
        } catch {
          /* 취소 실패(409 등)는 sweeper가 수렴 — 안내만 */
        }
      }
      setMessage(errorMsg || '결제가 완료되지 않았습니다. 장바구니는 그대로 남아 있어요.');
      setPhase('failed');
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'checking') {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center px-5 text-center">
        <p className="text-[14px] text-mute">결제를 확인하고 있습니다…</p>
      </div>
    );
  }

  if (phase === 'done' && order) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-5 py-16 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-ink text-2xl leading-none text-paper">✓</div>
        <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.2em] text-faint">Order complete</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">주문이 완료되었습니다</h1>
        <dl className="mt-6 w-full space-y-2.5 border-y border-line py-5 text-[13px]">
          <div className="flex justify-between"><dt className="text-mute">주문번호</dt><dd className="font-medium">{order.orderNumber}</dd></div>
          <div className="flex justify-between"><dt className="text-mute">결제금액</dt><dd className="font-bold">{won(order.amounts.grandTotal)}원</dd></div>
        </dl>
        <div className="mt-7 flex w-full gap-2.5">
          <Link to="/mypage" className="flex-1 border border-ink py-3.5 text-sm font-medium hover:bg-tint">주문내역 보기</Link>
          <Link to="/" className="flex-1 bg-ink py-3.5 text-sm font-medium text-paper hover:bg-ink/85">쇼핑 계속하기</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center px-5 py-16 text-center">
      <h1 className="text-xl font-bold tracking-tight">{phase === 'delayed' ? '결제 확인 지연' : '결제가 완료되지 않았습니다'}</h1>
      <p className="mt-3 text-[13px] text-mute">{message}</p>
      <div className="mt-7 flex w-full gap-2.5">
        <Link to={phase === 'delayed' ? '/mypage' : '/checkout'} className="flex-1 border border-ink py-3.5 text-sm font-medium hover:bg-tint">
          {phase === 'delayed' ? '마이페이지' : '주문서로 돌아가기'}
        </Link>
        <Link to="/" className="flex-1 bg-ink py-3.5 text-sm font-medium text-paper hover:bg-ink/85">홈으로</Link>
      </div>
    </div>
  );
}
