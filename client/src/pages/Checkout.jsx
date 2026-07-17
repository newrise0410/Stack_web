import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../lib/cart.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fetchProductBySlug } from '../lib/products.js';
import { createOrder, cancelOrder } from '../lib/orders.js';
import { requestPortonePay, completePayment, savePayContext, clearPayContext } from '../lib/payments.js';
import { fetchAvailableCoupons, claimCoupon } from '../lib/coupon.js';
import { fetchMyPoints } from '../lib/points.js';
import { won } from '../lib/format.js';
import { cldUrl } from '../lib/cloudinary.js';
import { Loading, LoadError } from '../components/Loading.jsx';

const FREE_SHIPPING = 50000;
const SHIPPING_FEE = 3000;
const EARN_RATE = 0.03;

// 번호형 주문 단계 섹션 헤더 (01 배송 → 02 상품 → 03 할인).
function Step({ n, title, children }) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-[12px] font-bold text-paper">
          {n}
        </span>
        <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function Checkout() {
  const { lines, remove } = useCart();
  const { user } = useAuth();
  const nav = useNavigate();
  const idemKeyRef = useRef(null); // 주문 멱등키(재시도 시 재사용, 성공 시 리셋)

  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [addrId, setAddrId] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null); // 완료된 주문
  const [coupons, setCoupons] = useState([]); // /coupons/available 결과
  const [couponCode, setCouponCode] = useState(''); // 적용한 쿠폰 코드
  const [codeInput, setCodeInput] = useState('');
  const [couponMsg, setCouponMsg] = useState('');
  const [pointsBalance, setPointsBalance] = useState(0);
  const [pointsLoaded, setPointsLoaded] = useState(false); // 잔액 조회 완료 여부
  const [pointsInput, setPointsInput] = useState('');

  useEffect(() => {
    // 장바구니에 담긴 slug만 개별 조회한다. 페이지네이션된 목록(limit:100)에 의존하면 활성 상품이
    // 100개를 넘길 때 목록 밖의 정상 상품이 '품절'로 오표기되어 주문에서 조용히 빠지므로, 카트 상품만
    // 정확히 가져와 status==='active'만 주문 가능으로 본다. 404(삭제)·품절은 missing으로 고지하되,
    // 네트워크/5xx 같은 조회 실패는 전부 품절로 오인시키지 않도록 로드 에러로 처리한다.
    const slugs = [...new Set(lines.map((l) => l.id))];
    if (slugs.length === 0) {
      setLoading(false);
    } else {
      Promise.all(
        slugs.map((slug) =>
          fetchProductBySlug(slug)
            .then((p) => ({ ok: true, product: p.status === 'active' ? p : null }))
            .catch((e) => ({ ok: e.response?.status === 404, product: null })),
        ),
      )
        .then((results) => {
          if (results.some((r) => !r.ok)) {
            setLoadErr(true);
            return;
          }
          setCatalog(results.map((r) => r.product).filter(Boolean));
        })
        .finally(() => setLoading(false));
    }
    fetchMyPoints()
      .then((d) => setPointsBalance(d.balance))
      .catch(() => setPointsBalance(0))
      .finally(() => setPointsLoaded(true));
    // 마운트 시점의 카트 기준으로 1회 로드 (이후 라인 변경은 rows/missing useMemo가 반영)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addresses = user?.addresses || [];
  // 기본 배송지 선택
  useEffect(() => {
    if (!addrId && addresses.length) {
      setAddrId(String((addresses.find((a) => a.isDefault) || addresses[0])._id));
    }
  }, [addresses, addrId]);

  const rows = useMemo(
    () =>
      lines
        .map((l) => ({ ...l, product: catalog.find((p) => p.id === l.id) }))
        .filter((r) => r.product),
    [lines, catalog],
  );

  // 카탈로그(활성 상품)에 없는 장바구니 라인 = 품절/판매중지 등으로 주문 불가 → 조용히 빼지 않고 고지.
  const missing = useMemo(
    () => lines.filter((l) => !catalog.find((p) => p.id === l.id)),
    [lines, catalog],
  );

  const itemsTotal = rows.reduce((s, r) => s + r.product.price * r.qty, 0);

  // 적용 가능한 쿠폰 목록 (상품금액 기준으로 서버가 적용성/할인액 계산)
  useEffect(() => {
    if (itemsTotal <= 0) return;
    fetchAvailableCoupons(itemsTotal)
      .then((d) => setCoupons(d.items))
      .catch(() => setCoupons([]));
  }, [itemsTotal]);

  // 적용 가능 + 실제 혜택(>0)이 있는 것만 (이미 무료배송인 주문의 free_shipping 쿠폰 등 -0원 제외)
  const applicable = coupons.filter((c) => c.applicable && c.discountTotal > 0);
  const selectedCoupon = applicable.find((c) => c.code === couponCode) || null;
  const isFreeShip = selectedCoupon?.discountType === 'free_shipping';
  const couponItemDiscount = selectedCoupon && !isFreeShip ? selectedCoupon.discountTotal : 0;
  const baseShipping = itemsTotal >= FREE_SHIPPING ? 0 : SHIPPING_FEE;
  const shippingFee = isFreeShip ? 0 : baseShipping;

  // 적립금 사용 (서버와 동일 클램프: 보유잔액·결제할금액 이내)
  const payableBeforePoints = Math.max(0, itemsTotal - couponItemDiscount + shippingFee);
  const maxUsablePoints = Math.min(pointsBalance, payableBeforePoints);
  const pointsToUse = Math.min(Math.max(0, parseInt(pointsInput, 10) || 0), maxUsablePoints);
  const grandTotal = Math.max(0, payableBeforePoints - pointsToUse);
  const earnPreview = Math.floor(grandTotal * EARN_RATE);

  // 쿠폰 적용/해제 등으로 사용가능 한도가 줄면, 입력값도 한도까지 내려 표시를 실제 사용량과 맞춘다.
  // 단, 잔액 조회 전(pointsLoaded=false)에는 한도가 0이라 사용자가 방금 친 값을 0으로 지우지 않도록 건너뛴다.
  useEffect(() => {
    if (!pointsLoaded) return;
    const entered = parseInt(pointsInput, 10) || 0;
    if (entered > maxUsablePoints) setPointsInput(maxUsablePoints > 0 ? String(maxUsablePoints) : '');
  }, [maxUsablePoints, pointsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyCode = async (e) => {
    e.preventDefault();
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setCouponMsg('');
    try {
      await claimCoupon(code);
    } catch (e2) {
      // 이미 보유(409)면 그대로 진행, 그 외는 메시지 표시
      if (e2.response?.status !== 409) {
        setCouponMsg(e2.response?.data?.message || '쿠폰 등록에 실패했습니다.');
        return;
      }
    }
    try {
      const d = await fetchAvailableCoupons(itemsTotal);
      setCoupons(d.items);
      const found = d.items.find((c) => c.code === code);
      if (found?.applicable) {
        setCouponCode(code);
        setCouponMsg('쿠폰이 적용되었습니다.');
      } else {
        setCouponMsg(found?.reason || '이 주문에 사용할 수 없는 쿠폰입니다.');
      }
      setCodeInput('');
    } catch {
      setCouponMsg('쿠폰 정보를 불러오지 못했습니다.');
    }
  };

  const selectedAddr = addresses.find((a) => String(a._id) === addrId);

  // 성공 마무리 공통 — 장바구니 제거는 서버가 paid를 확인한 뒤에만
  const finishPaid = (order) => {
    rows.forEach((r) => remove(r.id, r.option));
    idemKeyRef.current = null;
    clearPayContext();
    setDone(order);
  };

  const onPay = async () => {
    setErr('');
    if (!selectedAddr) return setErr('배송지를 선택해주세요.');
    if (!idemKeyRef.current) {
      idemKeyRef.current = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    setBusy(true);
    try {
      // 1) 서버 선주문(pending) — 금액은 전부 서버 계산
      const { order, checkout } = await createOrder(
        {
          items: rows.map((r) => ({ slug: r.id, qty: r.qty, option: r.option })),
          couponCode: selectedCoupon ? couponCode : undefined,
          pointsToUse: pointsToUse > 0 ? pointsToUse : undefined,
          shippingAddress: {
            recipient: selectedAddr.recipient,
            phone: selectedAddr.phone,
            zipcode: selectedAddr.zipcode,
            address1: selectedAddr.address1,
            address2: selectedAddr.address2,
            deliveryMemo: memo || selectedAddr.deliveryMemo,
          },
        },
        idemKeyRef.current,
      );

      // 응답 형식 방어 — 서버가 {order, checkout}을 주지 않으면(배포 버전 불일치 등)
      // 장바구니를 비우지 않고 중단한다. finishPaid(undefined)로 유령 상태가 되는 것 방지.
      if (!order?._id) {
        setErr('주문 처리 응답이 올바르지 않습니다. 잠시 후 다시 시도해주세요.');
        return undefined;
      }

      // 0원(포인트 전액) — 결제창 없이 완료
      if (!checkout) return finishPaid(order);

      // 모바일 리다이렉트/새로고침 대비 컨텍스트 보관
      savePayContext({
        orderId: checkout.orderId,
        orderNumber: checkout.orderNumber,
        idemKey: idemKeyRef.current,
        lines: rows.map((r) => ({ id: r.id, option: r.option })),
      });

      // 2) 포트원 결제창
      let rsp;
      try {
        rsp = await requestPortonePay({
          checkout,
          buyer: {
            email: user?.email,
            name: selectedAddr.recipient,
            tel: selectedAddr.phone,
            addr: `${selectedAddr.address1} ${selectedAddr.address2 || ''}`.trim(),
            postcode: selectedAddr.zipcode,
          },
        });
      } catch (payErr) {
        // 창닫힘/실패 — 서버가 결제 존재를 선확인 후 취소한다(청구-취소 경합 차단)
        try {
          const cancelled = await cancelOrder(checkout.orderId);
          if (cancelled?.status === 'paid') return finishPaid(cancelled); // 실제론 승인돼 있었음
          idemKeyRef.current = null; // 취소 확정 → 다음 시도는 새 주문
          clearPayContext();
          setErr(payErr.message);
        } catch (cx) {
          if (cx.response?.status === 409) setErr('결제 확인이 진행 중입니다. 마이페이지에서 주문 상태를 확인해주세요.');
          else setErr(payErr.message);
        }
        return undefined;
      }

      // 3) 서버 검증 — 성공 판정은 서버만 한다
      try {
        const d = await completePayment(rsp.imp_uid, checkout.orderNumber);
        if (d?.order && ['paid', 'already_paid'].includes(d.outcome)) {
          return finishPaid(d.order);
        }
        // 202(ready) 등 — 아직 서버가 결제를 확정하지 않음. 컨텍스트를 지우지 않고 재확인 유도.
        setErr(d?.message || '결제 확인이 지연되고 있습니다. 잠시 후 마이페이지에서 주문 상태를 확인해주세요.');
        return undefined;
      } catch (ve) {
        if (!ve.response) {
          // 네트워크 유실 — 주문을 취소하지 않는다(웹훅/재확인이 확정할 수 있음)
          setErr('결제 확인이 지연되고 있습니다. 잠시 후 마이페이지에서 주문 상태를 확인해주세요.');
        } else if (ve.response.status === 400) {
          idemKeyRef.current = null;
          clearPayContext();
          setErr(ve.response.data?.message || '결제에 실패했습니다.');
        } else {
          setErr(ve.response.data?.message || '결제 확인에 실패했습니다.');
        }
        return undefined;
      }
    } catch (e) {
      if (e.response?.status === 409) idemKeyRef.current = null; // 키 충돌/취소된 키 — 새 키로 재시도 가능
      setErr(e.response?.data?.message || '결제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  if (loading) return <Loading />;
  if (loadErr) return <LoadError message="주문 정보를 불러오지 못했습니다." />;

  // ── 주문 완료 화면 ──────────────────────────────
  if (done) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-5 py-16 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-ink text-2xl leading-none text-paper">
          ✓
        </div>
        <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.2em] text-faint">Order complete</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">주문이 완료되었습니다</h1>

        <dl className="mt-6 w-full space-y-2.5 border-y border-line py-5 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-mute">주문번호</dt>
            <dd className="font-medium">{done.orderNumber}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-mute">결제금액</dt>
            <dd className="font-bold">{won(done.amounts.grandTotal)}원</dd>
          </div>
          {done.pointsEarned > 0 && (
            <div className="flex justify-between">
              <dt className="text-mute">적립 예정</dt>
              <dd>{won(done.pointsEarned)}P</dd>
            </div>
          )}
        </dl>
        <p className="mt-3 text-[12px] text-mute">주문하신 조명은 국내 스튜디오에서 한 층씩 제작됩니다.</p>

        <div className="mt-7 flex w-full gap-2.5">
          <Link to="/mypage" className="flex-1 border border-ink py-3.5 text-sm font-medium hover:bg-tint">
            주문내역 보기
          </Link>
          <Link to="/" className="flex-1 bg-ink py-3.5 text-sm font-medium text-paper hover:bg-ink/85">
            쇼핑 계속하기
          </Link>
        </div>
      </div>
    );
  }

  // 빈 장바구니로 직접 들어온 경우 (또는 담긴 상품이 전부 품절/판매중지)
  if (rows.length === 0) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-[900px] flex-col items-center justify-center px-5 py-24 text-center">
        <p className="text-[14px] text-mute">
          {missing.length > 0 ? '장바구니의 상품이 모두 품절되거나 판매가 중지되었습니다.' : '주문할 상품이 없습니다.'}
        </p>
        <Link to="/" className="mt-6 inline-block bg-ink px-8 py-3 text-sm font-medium text-paper hover:bg-ink/85">
          쇼핑하러 가기
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[980px] px-5 py-10">
      <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-faint">Order</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">주문서</h1>

      <div className="mt-8 grid gap-10 md:grid-cols-[1fr_340px]">
        <div className="space-y-10">
          {/* 01 배송 정보 */}
          <Step n="01" title="배송 정보">
            {addresses.length === 0 ? (
              <div className="border border-line bg-tint/60 p-5 text-[13px] text-mute">
                등록된 배송지가 없습니다.{' '}
                <Link to="/mypage" className="font-medium text-ink underline-offset-4 hover:underline">
                  마이페이지에서 배송지 추가
                </Link>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {addresses.map((a) => {
                  const active = String(a._id) === addrId;
                  return (
                    <li key={a._id}>
                      <label
                        className={`flex cursor-pointer gap-3 border p-4 text-[13px] transition ${
                          active ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-mute'
                        }`}
                      >
                        <input
                          type="radio"
                          name="addr"
                          className="mt-0.5 accent-ink"
                          checked={active}
                          onChange={() => setAddrId(String(a._id))}
                        />
                        <div>
                          <p className="font-medium text-ink">
                            {a.recipient} {a.label && <span className="text-mute">· {a.label}</span>}
                            {a.isDefault && (
                              <span className="ml-2 rounded-full bg-tint px-2 py-0.5 text-[10px] text-mute">기본</span>
                            )}
                          </p>
                          <p className="mt-1 text-mute">
                            ({a.zipcode}) {a.address1} {a.address2}
                          </p>
                          <p className="text-mute">{a.phone}</p>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <input
              className="mt-2.5 w-full border border-line px-4 py-3 text-sm focus:border-ink focus:outline-none"
              placeholder="배송 메모 (예: 문 앞에 놓아주세요)"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </Step>

          {/* 02 주문 상품 */}
          <Step n="02" title={`주문 상품 ${rows.length}건`}>
            {missing.length > 0 && (
              <p className="mb-3 border border-line bg-tint px-3.5 py-2.5 text-[12px] text-mute">
                품절되거나 판매가 중지된 상품 {missing.length}건은 이 주문에서 제외됩니다. (장바구니에는 그대로 남겨둡니다)
              </p>
            )}
            <ul className="divide-y divide-line border-y border-line">
              {rows.map((r) => (
                <li key={`${r.id}-${r.option || ''}`} className="flex items-center gap-3.5 py-3.5">
                  <img
                    src={cldUrl(r.product.image, { w: 140, square: true })}
                    alt=""
                    className="h-16 w-16 shrink-0 bg-tint object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] text-mute">{r.product.brand}</p>
                    <p className="truncate text-[13px] font-medium">{r.product.name}</p>
                    <p className="mt-0.5 text-[12px] text-mute">
                      {r.option && `${r.option} · `}수량 {r.qty}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold">{won(r.product.price * r.qty)}원</span>
                </li>
              ))}
            </ul>
          </Step>

          {/* 03 할인 · 혜택 (쿠폰 + 적립금) */}
          <Step n="03" title="할인 · 혜택">
            <p className="mb-2 text-[13px] font-medium text-ink">쿠폰</p>
            <select
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              className="w-full border border-line px-4 py-3 text-sm focus:border-ink focus:outline-none"
            >
              <option value="">쿠폰 미적용</option>
              {applicable.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name} (-{won(c.discountTotal)}원)
                </option>
              ))}
            </select>
            {coupons.length > applicable.length && (
              <p className="mt-1 text-[11px] text-faint">일부 보유 쿠폰은 이 주문 조건(최소금액·만료·혜택 없음 등)에 맞지 않아 숨겨졌어요.</p>
            )}
            <form onSubmit={applyCode} className="mt-2 flex gap-2">
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="쿠폰 코드로 등록"
                className="flex-1 border border-line px-4 py-2.5 text-sm uppercase focus:border-ink focus:outline-none"
              />
              <button type="submit" className="border border-ink px-5 py-2.5 text-sm hover:bg-tint">등록</button>
            </form>
            {couponMsg && <p className="mt-1 text-[12px] text-mute">{couponMsg}</p>}

            <p className="mb-2 mt-7 text-[13px] font-medium text-ink">적립금</p>
            <div className="flex gap-2">
              <input
                type="number"
                value={pointsInput}
                onChange={(e) => {
                  // 입력 즉시 [0, 사용가능한도]로 클램프 — 표시값이 실제 차감액과 어긋나지 않게 한다.
                  // 잔액 조회 전에는 한도가 0이라 클램프하면 입력이 0으로 지워지므로, 조회 완료 후에만 클램프.
                  const raw = e.target.value;
                  if (raw === '') return setPointsInput('');
                  const n = Math.max(0, parseInt(raw, 10) || 0);
                  return setPointsInput(pointsLoaded ? String(Math.min(n, maxUsablePoints)) : String(n));
                }}
                placeholder="사용할 적립금"
                max={maxUsablePoints}
                className="flex-1 border border-line px-4 py-2.5 text-sm focus:border-ink focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setPointsInput(String(maxUsablePoints))}
                className="border border-ink px-5 py-2.5 text-sm hover:bg-tint"
              >
                모두 사용
              </button>
            </div>
            <p className="mt-1 text-[12px] text-mute">
              보유 {won(pointsBalance)}P · 이 주문 최대 {won(maxUsablePoints)}P 사용 가능
            </p>
          </Step>
        </div>

        {/* 결제 요약 */}
        <aside className="md:sticky md:top-[calc(var(--header-h)+1.5rem)] md:self-start">
          <div className="border border-line p-6">
            <h2 className="text-sm font-bold">결제 금액</h2>
            <dl className="mt-4 space-y-2.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-mute">상품 금액</dt>
                <dd>{won(itemsTotal)}원</dd>
              </div>
              {couponItemDiscount > 0 && (
                <div className="flex justify-between text-sale">
                  <dt>쿠폰 할인</dt>
                  <dd>-{won(couponItemDiscount)}원</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-mute">배송비</dt>
                <dd>{shippingFee === 0 ? (isFreeShip ? '무료 (쿠폰)' : '무료') : `${won(shippingFee)}원`}</dd>
              </div>
              {pointsToUse > 0 && (
                <div className="flex justify-between text-sale">
                  <dt>적립금 사용</dt>
                  <dd>-{won(pointsToUse)}원</dd>
                </div>
              )}
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="text-[13px] text-mute">최종 결제</span>
              <span className="text-xl font-bold">{won(grandTotal)}원</span>
            </div>
            {earnPreview > 0 && (
              <p className="mt-1 text-right text-[12px] text-mute">배송 완료 시 {won(earnPreview)}P 적립 예정</p>
            )}

            {err && <p className="mt-3 border border-sale/30 bg-sale/5 px-3 py-2 text-[13px] text-sale">{err}</p>}

            <button
              onClick={onPay}
              disabled={busy || !selectedAddr}
              className="mt-5 w-full bg-ink py-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-50"
            >
              {busy ? '결제 중…' : `${won(grandTotal)}원 결제하기`}
            </button>
            <p className="mt-3 text-center text-[11px] text-faint">KG이니시스 테스트 결제 — 실제 청구되지 않습니다</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
