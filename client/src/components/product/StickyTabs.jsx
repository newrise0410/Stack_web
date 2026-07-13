import { useEffect, useState } from 'react';

// 활성 판정선 = 축소 헤더 높이(--header-h) + 탭바/여유. 섹션 scroll-mt 안착점보다
// 살짝 아래여야 클릭 직후 해당 섹션이 바로 활성화된다.
function spyOffset() {
  const h = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h'), 10);
  return (Number.isFinite(h) ? h : 105) + 64;
}

// 상품 상세 인페이지 탭 — 헤더 아래 고정, 스크롤 스파이로 현재 섹션 강조.
export default function StickyTabs({ tabs }) {
  const [active, setActive] = useState(tabs[0]?.id);

  useEffect(() => {
    let ticking = false;
    const update = () => {
      ticking = false;
      const offset = spyOffset();
      let current = tabs[0]?.id;
      for (const t of tabs) {
        const el = document.getElementById(t.id);
        if (el && el.getBoundingClientRect().top - offset <= 0) current = t.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [tabs]);

  const go = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="sticky top-[var(--header-h)] z-20 border-y border-line bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[900px] gap-6 px-5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => go(t.id)}
            className={`relative -mb-px border-b-2 py-3.5 text-[14px] font-medium transition-colors ${
              active === t.id ? 'border-ink text-ink' : 'border-transparent text-mute hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
