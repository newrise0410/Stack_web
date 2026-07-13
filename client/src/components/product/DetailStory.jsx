import { cldUrl } from '../../lib/cloudinary.js';

// 상세페이지 롱폼 — 큰 이미지 + 실제 스펙 기반 에디토리얼 블록.
// 이미지가 여러 장이면 세로 스택으로 이어 붙인다(하이브리드: 이미지 + 구조화 HTML).
export default function DetailStory({ product }) {
  const images = product.images?.length ? product.images : [product.image];
  const highlights = [
    ['소재', product.material],
    ['크기', product.dims],
    ['조명', product.feature],
  ].filter(([, v]) => v);

  return (
    <div>
      {/* 히어로 상세컷 */}
      <figure className="overflow-hidden bg-tint">
        <img
          src={cldUrl(images[0], { w: 1200 })}
          alt={`${product.ko} 상세`}
          className="aspect-[4/5] w-full object-cover"
        />
      </figure>

      {/* 철학 카피 */}
      <div className="py-14 text-center">
        <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-faint">Layer by layer</p>
        <h2 className="mt-3 text-2xl font-bold tracking-tight">층이 곧 표면입니다</h2>
        <p className="mx-auto mt-4 max-w-md text-[14px] leading-relaxed text-mute">
          숨기지 않은 층선이 손끝에 결로 남습니다. 같은 도면이라도 층 높이에
          따라 감촉도 빛의 결도 달라집니다.
        </p>
      </div>

      {/* 스펙 하이라이트 3열 */}
      {highlights.length > 0 && (
        <dl className="grid grid-cols-1 divide-y divide-line border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {highlights.map(([label, value]) => (
            <div key={label} className="px-6 py-8 text-center">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.15em] text-faint">{label}</dt>
              <dd className="mt-2 text-[15px] font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* 추가 이미지가 있으면 세로 스택 */}
      {images.slice(1).map((src, i) => (
        <figure key={i} className="mt-4 overflow-hidden bg-tint">
          <img
            src={cldUrl(src, { w: 1200 })}
            alt={`${product.ko} 상세 ${i + 2}`}
            className="w-full object-cover"
          />
        </figure>
      ))}

      {/* 주문 제작 안내 밴드 */}
      <div className="mt-14 bg-tint px-6 py-12 text-center">
        <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-faint">Made to order</p>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-ink/80">
          모든 조명은 주문 후 국내 스튜디오에서 한 층씩 출력합니다.
          <br className="hidden sm:block" />
          {product.made ? ` ${product.made} 소요되며, ` : ' '}
          재고가 아닌 당신의 주문으로 시작됩니다.
        </p>
      </div>
    </div>
  );
}
