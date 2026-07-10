import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard.jsx';
import Stars from '../components/Stars.jsx';
import WishButton from '../components/WishButton.jsx';
import ReviewSection from '../components/ReviewSection.jsx';
import { fetchProductBySlug, fetchProducts } from '../lib/products.js';
import { Loading } from '../components/Loading.jsx';
import useDocumentTitle from '../lib/useDocumentTitle.js';
import { won, discountRate } from '../lib/format.js';
import { useCart } from '../lib/cart.jsx';
import { cldUrl } from '../lib/cloudinary.js';

function Spec({ label, value }) {
  return (
    <div className="flex gap-6 py-2 text-[13px]">
      <dt className="w-24 shrink-0 text-mute">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

export default function Product() {
  const { id } = useParams();
  const { add } = useCart();
  const nav = useNavigate();

  const [product, setProduct] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [opt, setOpt] = useState('');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [mainImg, setMainImg] = useState(0);

  useDocumentTitle(product?.name);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setQty(1);
    setMainImg(0);
    Promise.all([fetchProductBySlug(id), fetchProducts({ limit: 100 })])
      .then(([p, all]) => {
        if (!active) return;
        setProduct(p);
        setOpt(p.options[0] || '');
        setRelated(all.filter((x) => x.id !== p.id).slice(0, 4));
      })
      .catch(() => active && setProduct(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  // 리뷰 작성/삭제 후 상품 평점 헤더 갱신
  const refreshProduct = () => fetchProductBySlug(id).then(setProduct).catch(() => {});

  if (loading) return <Loading />;

  if (!product) {
    return (
      <div className="mx-auto max-w-[1280px] px-5 py-32 text-center">
        <p className="text-sm text-mute">404</p>
        <h1 className="mt-2 text-2xl font-bold">상품을 찾을 수 없어요</h1>
        <Link to="/" className="mt-6 inline-block border border-ink px-6 py-3 text-sm hover:bg-ink hover:text-paper">
          홈으로
        </Link>
      </div>
    );
  }

  const rate = discountRate(product.price, product.compareAt);
  const soldout = product.status === 'soldout';
  const images = product.images?.length ? product.images : [product.image];

  const onAdd = () => {
    add(product.id, qty, opt);
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
  };

  const onBuyNow = () => {
    add(product.id, qty, opt);
    nav('/checkout');
  };

  return (
    <>
      <div className="mx-auto max-w-[1280px] px-5 pt-5">
        <nav className="flex gap-1.5 text-[12px] text-mute">
          <Link to="/" className="hover:text-ink">HOME</Link>
          <span>/</span>
          <span>{product.category.toUpperCase()}</span>
          <span>/</span>
          <span className="text-ink">{product.name}</span>
        </nav>
      </div>

      <div className="mx-auto grid max-w-[1280px] gap-10 px-5 py-6 md:grid-cols-2 md:gap-14">
        {/* Gallery */}
        <div>
          <div className="overflow-hidden bg-tint">
            <img src={cldUrl(images[mainImg], { w: 1200 })} alt={product.ko} className="aspect-[4/5] w-full object-cover" />
          </div>
          {images.length > 1 && (
            <div className="mt-3 flex gap-2">
              {images.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setMainImg(i)}
                  aria-label={`${i + 1}번 이미지 보기`}
                  className={`h-16 w-16 overflow-hidden bg-tint ring-1 transition ${
                    i === mainImg ? 'ring-ink' : 'ring-line hover:ring-mute'
                  }`}
                >
                  <img src={cldUrl(src, { w: 160, square: true })} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info (sticky) */}
        <div className="md:pt-2">
          <div className="md:sticky md:top-36">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[13px] font-semibold tracking-wide text-mute">{product.brand}</p>
              <WishButton slug={product.id} size="text-2xl" />
            </div>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight sm:text-[26px]">{product.name}</h1>
            <p className="mt-1 text-[14px] text-mute">{product.ko}</p>
            {product.ratingCount > 0 && (
              <div className="mt-2 flex items-center gap-1.5">
                <Stars value={product.ratingAvg} size="text-[13px]" />
                <span className="text-[13px] text-mute">
                  {product.ratingAvg.toFixed(1)} ({product.ratingCount})
                </span>
              </div>
            )}
            {soldout && (
              <span className="mt-3 inline-block bg-ink px-2 py-1 text-[11px] font-medium tracking-wide text-paper">
                SOLD OUT
              </span>
            )}

            <div className="mt-5 flex items-baseline gap-2">
              {rate > 0 && <span className="text-2xl font-bold text-sale">{rate}%</span>}
              <span className="text-2xl font-bold">{won(product.price)}원</span>
              {rate > 0 && (
                <span className="text-sm text-faint line-through">{won(product.compareAt)}원</span>
              )}
            </div>

            <p className="mt-5 text-[14px] leading-relaxed text-ink/75">{product.blurb}</p>

            {/* option */}
            {product.options.length > 0 && (
              <div className="mt-7">
                <label className="mb-2 block text-[13px] text-mute">옵션 선택</label>
                <select
                  value={opt}
                  onChange={(e) => setOpt(e.target.value)}
                  className="w-full border border-line bg-paper px-4 py-3 text-sm focus:border-ink focus:outline-none"
                >
                  {product.options.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
            )}

            {/* qty */}
            <div className="mt-4 flex items-center justify-between border border-line px-4 py-3">
              <span className="text-[13px] text-mute">수량</span>
              <div className="flex items-center gap-4">
                <button className="text-lg leading-none text-mute hover:text-ink" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                <span className="w-6 text-center text-sm">{qty}</span>
                <button className="text-lg leading-none text-mute hover:text-ink" onClick={() => setQty((q) => Math.min(99, q + 1))}>+</button>
              </div>
            </div>

            {/* total */}
            <div className="mt-5 flex items-baseline justify-between border-t border-line pt-4">
              <span className="text-[13px] text-mute">총 상품금액</span>
              <span className="text-xl font-bold">{won(product.price * qty)}원</span>
            </div>

            {/* actions */}
            {soldout ? (
              <button
                disabled
                className="mt-4 w-full cursor-not-allowed border border-line bg-tint py-4 text-sm font-medium text-mute"
              >
                품절된 상품입니다
              </button>
            ) : (
              <div className="mt-4 flex gap-2.5">
                <button
                  onClick={onAdd}
                  className="flex-1 border border-ink py-4 text-sm font-medium transition-colors hover:bg-tint"
                >
                  {added ? '장바구니 담김 ✓' : '장바구니'}
                </button>
                <button
                  onClick={onBuyNow}
                  className="flex-1 bg-ink py-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85"
                >
                  바로 구매
                </button>
              </div>
            )}

            {/* spec */}
            <dl className="mt-9 divide-y divide-line border-y border-line">
              <Spec label="소재" value={product.material} />
              <Spec label="크기" value={product.dims} />
              <Spec label="기능" value={product.feature} />
              <Spec label="제작" value={product.made} />
            </dl>
            <p className="mt-4 text-[12px] leading-relaxed text-faint">
              모든 조명은 주문 후 제작됩니다 · 5만원 이상 무료배송 · 단순변심 교환/반품 가능
            </p>
          </div>
        </div>
      </div>

      {/* detail image */}
      <section className="mx-auto mt-16 max-w-[900px] px-5">
        <div className="overflow-hidden bg-tint">
          <img src={cldUrl(product.image, { w: 1200 })} alt={`${product.ko} 상세`} className="aspect-[4/5] w-full object-cover" />
        </div>
        <div className="py-12 text-center">
          <h2 className="text-xl font-bold tracking-tight">층이 곧 표면입니다</h2>
          <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-mute">
            숨기지 않은 층선이 손끝에 결로 남습니다. 같은 도면이라도 층 높이에
            따라 감촉도 빛의 결도 달라집니다.
          </p>
        </div>
      </section>

      {/* reviews */}
      <ReviewSection
        slug={product.id}
        ratingAvg={product.ratingAvg}
        ratingCount={product.ratingCount}
        onChanged={refreshProduct}
      />

      {/* related */}
      {related.length > 0 && (
        <section className="mx-auto max-w-[1280px] px-5 pt-16">
          <h2 className="mb-6 text-xl font-bold tracking-tight">함께 보면 좋은</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-9 md:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
