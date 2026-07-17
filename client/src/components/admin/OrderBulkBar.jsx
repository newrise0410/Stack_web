// 선택 주문 일괄 액션 바 — 탭 맥락에 맞는 버튼만 노출하고, 처리 결과(부분 실패 사유)를 표시한다.
const ACTIONS_BY_TAB = {
  paid: [{ key: 'preparing', label: '제작 시작' }, { key: 'cancelled', label: '주문 취소', danger: true }],
  preparing: [{ key: 'shipped', label: '배송처리' }, { key: 'cancelled', label: '주문 취소', danger: true }],
  shipped: [{ key: 'delivered', label: '배송완료' }],
  pending: [{ key: 'cancelled', label: '주문 취소', danger: true }],
};

export default function OrderBulkBar({ tab, count, busy, onAction, result, onClearResult }) {
  const actions = ACTIONS_BY_TAB[tab] || [];
  return (
    <div className="mt-4">
      {count > 0 && (
        <div className="flex flex-wrap items-center gap-2 border border-ink bg-tint/40 px-4 py-2.5">
          <span className="text-[13px] font-semibold">{count}건 선택</span>
          {actions.map((a) => (
            <button
              key={a.key}
              disabled={busy}
              onClick={() => onAction(a.key)}
              className={`border px-3.5 py-1.5 text-[13px] transition-colors disabled:opacity-50 ${
                a.danger ? 'border-sale/40 text-sale hover:bg-sale/5' : 'border-ink hover:bg-tint'
              }`}
            >
              {a.label}
            </button>
          ))}
          <button
            disabled={busy}
            onClick={() => onAction('print')}
            className="border border-line px-3.5 py-1.5 text-[13px] hover:border-ink disabled:opacity-50"
          >
            주문서 인쇄
          </button>
        </div>
      )}
      {result && (
        <div className="mt-2 border border-line bg-paper px-4 py-3 text-[13px]">
          <div className="flex items-center justify-between">
            <p>
              <span className="font-semibold">{result.succeeded}건 처리</span>
              {result.failed.length > 0 && <span className="ml-2 text-sale">{result.failed.length}건 실패</span>}
            </p>
            <button onClick={onClearResult} className="text-[12px] text-mute hover:text-ink">닫기</button>
          </div>
          {result.failed.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12px] text-mute">
              {result.failed.map((f, i) => (
                <li key={i}>· {f.orderNumber || f.orderId}: {f.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
