import { useState } from 'react';
import { cldUrl } from '../../lib/cloudinary.js';

// 상품 이미지 갤러리 — 메인 4:5 + 썸네일 스트립.
export default function Gallery({ images, alt }) {
  const [active, setActive] = useState(0);
  const list = images?.length ? images : [];
  const main = list[active] || list[0];

  return (
    <div>
      <div className="overflow-hidden bg-tint">
        <img
          src={cldUrl(main, { w: 1200 })}
          alt={alt}
          className="aspect-[4/5] w-full object-cover"
        />
      </div>
      {list.length > 1 && (
        <div className="mt-3 flex gap-2">
          {list.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`${i + 1}번 이미지 보기`}
              className={`h-16 w-16 overflow-hidden bg-tint ring-1 transition ${
                i === active ? 'ring-ink' : 'ring-line hover:ring-mute'
              }`}
            >
              <img src={cldUrl(src, { w: 160, square: true })} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
