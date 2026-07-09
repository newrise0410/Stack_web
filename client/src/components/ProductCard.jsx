import { Link } from 'react-router-dom';
import { won, discountRate } from '../lib/format.js';
import Stars from './Stars.jsx';
import WishButton from './WishButton.jsx';
import { cldUrl } from '../lib/cloudinary.js';

// 29CM-style card: large image, then small brand / name / discount+price.
export default function ProductCard({ product, rank }) {
  const rate = discountRate(product.price, product.compareAt);

  return (
    <Link to={`/objects/${product.id}`} className="group block">
      <div className="relative overflow-hidden bg-tint">
        {rank != null && (
          <span className="absolute left-0 top-0 z-10 bg-ink px-2.5 py-1 text-sm font-semibold text-paper">
            {rank}
          </span>
        )}
        {product.badge && (
          <span className="absolute right-2 top-2 z-10 text-[11px] font-semibold tracking-wide text-ink">
            {product.badge}
          </span>
        )}
        <img
          src={cldUrl(product.image, { w: 600 })}
          alt={product.ko}
          loading="lazy"
          className="aspect-[4/5] w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
        />
        <WishButton
          slug={product.id}
          size="text-lg"
          className="absolute bottom-2 right-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-paper/85 backdrop-blur-sm"
        />
      </div>

      <div className="pt-3">
        <p className="text-[11px] font-semibold tracking-wide text-mute">{product.brand}</p>
        <h3 className="mt-1 truncate text-[13px] text-ink">{product.ko}</h3>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          {rate > 0 && <span className="text-[15px] font-bold text-sale">{rate}%</span>}
          <span className="text-[15px] font-bold text-ink">{won(product.price)}원</span>
          {rate > 0 && (
            <span className="text-xs text-faint line-through">{won(product.compareAt)}원</span>
          )}
        </div>
        {product.ratingCount > 0 && (
          <div className="mt-1 flex items-center gap-1">
            <Stars value={product.ratingAvg} size="text-[10px]" />
            <span className="text-[11px] text-faint">({product.ratingCount})</span>
          </div>
        )}
      </div>
    </Link>
  );
}
