export default function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto max-w-[1280px] px-5 py-14">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <p className="text-lg font-extrabold tracking-tight">STACK N' STAK</p>
            <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-mute">
              필라멘트를 한 층씩 쌓아 만드는 3D 프린팅 조명·오브제. 모든 제품은
              주문 후 국내 스튜디오에서 제작합니다.
            </p>
          </div>

          <nav className="text-[13px]">
            <p className="mb-3 font-semibold">SHOP</p>
            <ul className="space-y-2 text-mute">
              <li><a className="hover:text-ink" href="#lighting">Lighting</a></li>
              <li><a className="hover:text-ink" href="#object">Object</a></li>
              <li><a className="hover:text-ink" href="#desk">Desk</a></li>
            </ul>
          </nav>

          <nav className="text-[13px]">
            <p className="mb-3 font-semibold">CS</p>
            <ul className="space-y-2 text-mute">
              <li><a className="hover:text-ink" href="#!">배송 · 교환</a></li>
              <li><a className="hover:text-ink" href="#!">자주 묻는 질문</a></li>
              <li><a className="hover:text-ink" href="#!">문의하기</a></li>
            </ul>
          </nav>
        </div>

        <div className="mt-12 border-t border-line pt-6 text-[11px] leading-relaxed text-faint">
          <p>Stack N' Stak · 서울특별시 · 사업자등록번호 000-00-00000 · 통신판매업 2026-서울-00000</p>
          <p className="mt-1">© 2026 Stack N' Stak</p>
        </div>
      </div>
    </footer>
  );
}
