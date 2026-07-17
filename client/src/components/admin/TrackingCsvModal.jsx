import { useState } from 'react';
import { parseTrackingCsv } from '../../lib/csv.js';
import { bulkTracking } from '../../lib/admin.js';

// 송장 CSV 업로드 — 파싱 미리보기(정상/오류 분리) 후 확인 시에만 서버 호출.
// CSV 형식: 주문번호, 택배사, 송장번호 (헤더 행 자동 감지)
export default function TrackingCsvModal({ onClose, onDone }) {
  const [parsed, setParsed] = useState(null); // {rows, errors}
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setErr('');
    const text = await file.text();
    const p = parseTrackingCsv(text);
    if (p.rows.length > 100) {
      setErr('한 번에 100건까지 업로드할 수 있습니다. 파일을 나눠주세요.');
      setParsed(null);
      return;
    }
    setParsed(p);
  };

  const submit = async () => {
    if (!parsed?.rows.length) return;
    setBusy(true);
    try {
      const r = await bulkTracking(parsed.rows);
      // 파싱 단계 오류도 실패 목록에 합쳐 한 번에 보여준다
      onDone({
        succeeded: r.succeeded,
        failed: [
          ...parsed.errors.map((x) => ({ orderId: '', orderNumber: `${x.line}행`, message: x.message })),
          ...r.failed,
        ],
      });
    } catch (e2) {
      setErr(e2.response?.data?.message || '업로드 처리에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md border border-line bg-paper p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-bold">송장 CSV 업로드</h2>
        <p className="mt-1 text-[12px] text-mute">형식: 주문번호, 택배사, 송장번호 (첫 행이 제목이면 자동으로 건너뜁니다)</p>

        <label className="mt-4 block cursor-pointer border border-dashed border-line px-4 py-6 text-center text-[13px] text-mute hover:border-ink">
          {fileName || 'CSV 파일 선택'}
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
        </label>

        {err && <p className="mt-2 text-[12px] text-sale">{err}</p>}

        {parsed && (
          <div className="mt-3 text-[13px]">
            <p><span className="font-semibold">{parsed.rows.length}건</span> 배송처리 가능
              {parsed.errors.length > 0 && <span className="ml-2 text-sale">{parsed.errors.length}건 형식 오류</span>}
            </p>
            {parsed.errors.length > 0 && (
              <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto text-[12px] text-mute">
                {parsed.errors.map((x, i) => <li key={i}>· {x.line}행: {x.message}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 border border-line py-2.5 text-sm hover:border-ink">닫기</button>
          <button
            onClick={submit}
            disabled={busy || !parsed?.rows.length}
            className="flex-1 bg-ink py-2.5 text-sm text-paper disabled:opacity-50"
          >
            {busy ? '처리 중…' : `${parsed?.rows.length || 0}건 배송처리`}
          </button>
        </div>
      </div>
    </div>
  );
}
