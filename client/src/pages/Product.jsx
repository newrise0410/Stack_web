import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard.jsx';
import ReviewSection from '../components/ReviewSection.jsx';
import Gallery from '../components/product/Gallery.jsx';
import BuyPanel from '../components/product/BuyPanel.jsx';
import StickyTabs from '../components/product/StickyTabs.jsx';
import MobileBuyBar from '../components/product/MobileBuyBar.jsx';
import ShippingInfo from '../components/product/ShippingInfo.jsx';
import DetailStory from '../components/product/DetailStory.jsx';
import { fetchProductBySlug, fetchProducts } from '../lib/products.js';
import { Loading } from '../components/Loading.jsx';
import useDocumentTitle from '../lib/useDocumentTitle.js';
import { discountRate } from '../lib/format.js';
import { useCart } from '../lib/cart.jsx';

// 섹션 앵커 공통 오프셋 — 축소 헤더(--header-h) + 탭바 높이만큼 확보.
const ANCHOR = 'scroll-mt-[calc(var(--header-h)+3.5rem)]';

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

  useDocumentTitle(product?.name);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setQty(1);
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

  const tabs = useMemo(
    () => [
      { id: 'info', label: '상품정보' },
      { id: 'reviews', label: `리뷰${product?.ratingCount ? ` ${product.ratingCount}` : ''}` },
      { id: 'shipping', label: '배송·반품' },
    ],
    [product?.ratingCount],
  );

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
        <Gallery images={images} alt={product.ko} />
        <div className="md:pt-2">
          <BuyPanel
            product={product}
            rate={rate}
            soldout={soldout}
            opt={opt}
            setOpt={setOpt}
            qty={qty}
            setQty={setQty}
            added={added}
            onAdd={onAdd}
            onBuyNow={onBuyNow}
          />
        </div>
      </div>

      {/* 인페이지 탭 + 탭 섹션들 — sticky가 이 컨테이너 안에서 유지되도록 함께 묶는다 */}
      <div className="mt-8">
        <StickyTabs tabs={tabs} />

        {/* 상품정보 */}
        <section id="info" className={`mx-auto max-w-[900px] px-5 pt-12 ${ANCHOR}`}>
          <DetailStory product={product} />
        </section>

        {/* 리뷰 */}
        <div id="reviews" className={ANCHOR}>
          <ReviewSection
            slug={product.id}
            ratingAvg={product.ratingAvg}
            ratingCount={product.ratingCount}
            onChanged={refreshProduct}
          />
        </div>

        {/* 배송·반품 */}
        <section id="shipping" className={`mx-auto max-w-[900px] px-5 pt-16 ${ANCHOR}`}>
          <ShippingInfo />
        </section>
      </div>

      {/* 관련 */}
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

      {/* 모바일 하단 고정바가 마지막 콘텐츠를 가리지 않도록 여백 */}
      <div className="h-24 md:hidden" />

      <MobileBuyBar
        price={product.price}
        qty={qty}
        soldout={soldout}
        added={added}
        onAdd={onAdd}
        onBuyNow={onBuyNow}
      />
    </>
  );
}
