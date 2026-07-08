// 로딩/에러 공용 표시. Render 무료 백엔드의 콜드스타트(~50초)를 안내한다.
export function Loading({ label = '불러오는 중…' }) {
  return (
    <div className="mx-auto max-w-[1280px] px-5 py-24 text-center">
      <p className="text-mute">{label}</p>
      <p className="mt-2 text-[12px] text-faint">
        서버가 절전 상태였다면 첫 응답까지 최대 1분 정도 걸릴 수 있어요.
      </p>
    </div>
  );
}

export function LoadError({ message = '불러오지 못했습니다.', onRetry }) {
  return (
    <div className="mx-auto max-w-[1280px] px-5 py-24 text-center">
      <p className="text-mute">{message}</p>
      <button
        onClick={onRetry || (() => window.location.reload())}
        className="mt-5 border border-ink px-6 py-2.5 text-sm font-medium hover:bg-tint"
      >
        다시 시도
      </button>
    </div>
  );
}
