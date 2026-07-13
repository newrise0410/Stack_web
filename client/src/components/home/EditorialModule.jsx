import { Link } from 'react-router-dom';
import WishButton from '../WishButton.jsx';
import { cldUrl } from '../../lib/cloudinary.js';
import { won, discountRate } from '../../lib/format.js';

// 상품 리스트 행 — 썸네일 · 브랜드 · 이름 · 할인/가격 · 찜.
function ProductRow({ product }) {
  const rate = discountRate(product.price, product.compareAt);
  return (
    <li className="flex items-center gap-3 py-3">
      <Link to={`/objects/${product.id}`} className="h-14 w-14 shrink-0 overflow-hidden bg-tint">
        <img src={cldUrl(product.image, { w: 120, square: true })} alt={product.ko} className="h-full w-full object-cover" />
      </Link>
      <Link to={`/objects/${product.id}`} className="min-w-0 flex-1">
        <p className="truncate text-[11px] text-mute">{product.brand}</p>
        <p className="truncate text-[13px] text-ink">{product.name}</p>
        <p className="mt-0.5 text-[13px]">
          {rate > 0 && <span className="font-bold text-sale">{rate}% </span>}
          <span className="font-bold">{won(product.price)}원</span>
        </p>
      </Link>
      <WishButton slug={product.id} size="text-lg" className="shrink-0" />
    </li>
  );
}

// 29cm 홈 에디토리얼 모듈 구조 이식 — 3열, 각 열 = 이미지 카드 + 제목 + 서브카피 + 상품 리스트.
export default function EditorialModule({ columns }) {
  return (
    <section className="mx-auto max-w-[1280px] px-5 pt-16">
      <div className="grid grid-cols-1 gap-x-6 gap-y-10 md:grid-cols-3">
        {columns.map((col) => (
          <div key={col.to}>
            <Link to={col.to} className="group block overflow-hidden bg-tint">
              <img
                src={cldUrl(col.image, { w: 800 })}
                alt={col.title}
                className="aspect-[4/3] w-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
            </Link>
            <h3 className="mt-4 text-lg font-bold tracking-tight">{col.title}</h3>
            <p className="mt-1 text-[13px] text-mute">{col.subtitle}</p>
            <ul className="mt-2 divide-y divide-line border-t border-line">
              {col.products.map((p) => (
                <ProductRow key={p.id} product={p} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
