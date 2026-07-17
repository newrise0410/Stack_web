import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOps, fetchEvents, requeueEvent } from '../../lib/admin.js';
import { useToast } from '../../lib/toast.jsx';
import StatCard from '../../components/admin/StatCard.jsx';

// 운영 상태 — 지금까지 stdout에만 있던 '조용한 실패'를 감지·복구하는 곳.
export default function OpsAdmin() {
  const toast = useToast();
  const [ops, setOps] = useState(null);
  const [events, setEvents] = useState(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setErr('');
    // 두 요청을 독립 처리한다 — 이건 '조용한 실패 감지' 화면이라, 부차적인 이벤트 목록 조회가
    // 실패해도 핵심 지표(카운트·잡 생존)와 배너까지 사라지면 화면의 존재 이유와 모순된다.
    fetchOps()
      .then((o) => active && setOps(o))
      .catch(() => active && setErr('운영 상태를 불러오지 못했습니다.'));
    fetchEvents({ status: 'failed', limit: 50 })
      .then((e) => active && setEvents(e))
      .catch(() => active && setEvents({ items: [], _error: true }));
    return () => { active = false; };
  }, [reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const onRequeue = async (id) => {
    // 부수효과가 이미 부분 적용된 이벤트를 재큐하면 판매수·메일이 중복될 수 있다(outbox 멱등성 한계).
    // '진짜 미적용 실패'에만 쓰라고 명시적으로 확인받는다.
    if (!window.confirm(
      '이 이벤트를 재큐할까요?\n\n오류 원인이 해소됐을 때만 사용하세요. 부수효과가 이미 일부 '
      + '적용된 상태였다면 판매수 집계나 메일이 중복될 수 있습니다.',
    )) return;
    setBusyId(id);
    try {
      await requeueEvent(id);
      toast.success('재큐했습니다. 다음 처리 사이클에서 재시도됩니다.');
      reload();
    } catch (e) {
      toast.error(e.response?.data?.message || '재큐에 실패했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  if (err) return <p className="py-12 text-center text-mute">{err}</p>;
  if (!ops) return <p className="py-12 text-center text-mute">불러오는 중…</p>;

  const c = ops.counts;
  const lc = ops.lastCycle;
  // 결제 잡이 최근 5분 내 돌았으면 정상으로 본다(주기 60초). null이면 아직 안 돎/기동 안 함.
  const jobFresh = lc?.at && Date.now() - new Date(lc.at).getTime() < 5 * 60 * 1000;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">운영 상태</h1>
        <button onClick={reload} className="text-[13px] text-mute hover:text-ink">새로고침</button>
      </div>
      <p className="mt-1 text-[13px] text-mute">사람이 개입해야 할 실패를 모읍니다. 값이 0이 아니면 확인이 필요합니다.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* review·benefits·webhook은 주문 목록/DB로 이어짐. outbox는 아래 목록에서 바로 처리 */}
        <StatCard label="환불 확인 필요" value={`${c.refundReview}건`} sub={c.refundReview ? '주문에서 재시도' : '정상'} />
        <StatCard label="outbox 실패" value={`${c.failedEvents}건`} sub={c.failedEvents ? '아래에서 재큐' : '정상'} />
        <StatCard label="취소 원복 실패" value={`${c.benefitsStuck}건`} sub={c.benefitsStuck ? '쿠폰·적립 미반환' : '정상'} />
        <StatCard label="웹훅 오류" value={`${c.webhookErrors}건`} sub="포트원 수신 실패" />
      </div>

      <div className={`mt-3 border px-4 py-3 text-[13px] ${jobFresh ? 'border-line text-mute' : 'border-sale text-sale'}`}>
        {lc
          ? <>결제 처리 잡: 마지막 실행 {new Date(lc.at).toLocaleString('ko-KR')} · {lc.ok ? '정상' : `오류(${lc.error})`}{!jobFresh && ' — 5분 넘게 안 돌았습니다. 서버 확인 필요'}</>
          : '결제 처리 잡이 아직 실행되지 않았습니다(기동 직후이거나 포트원 미설정).'}
      </div>

      {c.refundReview > 0 && (
        <p className="mt-4 text-[13px]">
          <Link to="/admin/orders?refund=review" className="text-sale underline underline-offset-4">
            환불 확인이 필요한 주문 {c.refundReview}건 보기 →
          </Link>
        </p>
      )}

      <div className="mt-10">
        <h2 className="text-lg font-bold">outbox 영구 실패</h2>
        <p className="mt-1 text-[13px] text-mute">
          재시도가 소진된 이벤트입니다. 방치하면 판매수 집계·주문 메일이 어긋납니다. 원인을 확인한 뒤 재큐하세요.
        </p>
        <div className="mt-3 divide-y divide-line border-y border-line">
          {events?._error && <p className="py-6 text-center text-sale">이벤트 목록을 불러오지 못했습니다. 새로고침해주세요.</p>}
          {events && !events._error && events.items?.length === 0 && (
            <p className="py-6 text-center text-mute">영구 실패한 이벤트가 없습니다.</p>
          )}
          {events?.items?.length ? events.items.map((ev) => (
            <div key={ev._id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{ev.type}</span>
                  {ev.order?.orderNumber && (
                    <Link to={`/admin/orders/${ev.order._id}`} className="text-[12px] text-mute hover:text-ink">
                      {ev.order.orderNumber}
                    </Link>
                  )}
                  <span className="text-[12px] text-faint">시도 {ev.attempts}회</span>
                </div>
                {ev.lastError && <p className="mt-0.5 truncate text-[12px] text-sale">{ev.lastError}</p>}
              </div>
              <button
                onClick={() => onRequeue(ev._id)}
                disabled={busyId === ev._id}
                className="shrink-0 border border-ink px-4 py-2 text-[13px] font-medium hover:bg-tint disabled:opacity-50"
              >
                {busyId === ev._id ? '처리 중…' : '재큐'}
              </button>
            </div>
          )) : null}
        </div>
      </div>
    </div>
  );
}
