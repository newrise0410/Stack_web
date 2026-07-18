import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchProductionSummary } from '../../lib/admin.js';
import { cldUrl } from '../../lib/cloudinary.js';

// 옵션별 제작 집계 — 미발송(결제완료·제작중) 주문을 상품×옵션 수량으로 합산.
// 3D 프린터 출력 계획용. 인쇄 시 사이드바·버튼은 print CSS로 숨긴다(AdminLayout에 print:hidden).
export default function Production() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProductionSummary().then(setData).catch(() => setError('집계를 불러오지 못했습니다.'));
  }, []);

  if (error) return <p className="py-12 text-center text-mute">{error}</p>;
  if (!data) return <p className="py-12 text-center text-mute">불러오는 중…</p>;

  const totals = data.items.reduce(
    (a, i) => ({ paid: a.paid + i.paidQty, preparing: a.preparing + i.preparingQty, total: a.total + i.totalQty }),
    { paid: 0, preparing: 0, total: 0 },
  );

  return (
    <div className="production-print">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">제작 리스트</h1>
        <button onClick={() => window.print()} className="border border-ink px-4 py-2 text-sm hover:bg-tint">인쇄</button>
      </div>
      <p className="mt-1 text-[12px] text-mute">
        미발송(결제완료·제작중) 기준 · {new Date(data.generatedAt).toLocaleString('ko-KR')}
      </p>

      {data.items.length === 0 ? (
        <p className="py-12 text-center text-mute">제작할 주문이 없습니다.</p>
      ) : (
        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="border-y border-line text-left text-[12px] text-mute">
              <th className="py-2 pr-3">상품</th>
              <th className="py-2 pr-3">옵션</th>
              <th className="py-2 pr-3 text-right">신규주문</th>
              <th className="py-2 pr-3 text-right">제작중</th>
              <th className="py-2 pr-3 text-right">합계</th>
              <th className="py-2 pr-3 text-right">주문 건수</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <tr
                key={`${i.slug}-${i.option || ''}`}
                onClick={() => nav(`/admin/orders?product=${encodeURIComponent(i.slug)}&status=paid`)}
                className="cursor-pointer border-b border-line hover:bg-tint/40"
              >
                <td className="py-2.5 pr-3">
                  <span className="flex items-center gap-2.5">
                    {i.image && <img src={cldUrl(i.image, { w: 80, square: true })} alt="" className="h-9 w-9 bg-tint object-cover print:hidden" />}
                    <span>
                      <span className="font-medium">{i.nameKo || i.name}</span>
                      {i.sku && <span className="ml-2 font-mono text-[11px] text-faint">{i.sku}</span>}
                    </span>
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-mute">{i.option || '-'}</td>
                <td className="py-2.5 pr-3 text-right">{i.paidQty}</td>
                <td className="py-2.5 pr-3 text-right">{i.preparingQty}</td>
                <td className="py-2.5 pr-3 text-right font-bold">{i.totalQty}</td>
                <td className="py-2.5 pr-3 text-right text-mute">{i.orderCount}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-ink font-bold">
              <td className="py-2.5 pr-3">합계</td>
              <td className="py-2.5 pr-3" />
              <td className="py-2.5 pr-3 text-right">{totals.paid}</td>
              <td className="py-2.5 pr-3 text-right">{totals.preparing}</td>
              <td className="py-2.5 pr-3 text-right">{totals.total}</td>
              <td className="py-2.5 pr-3" />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
