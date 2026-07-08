export default function Pagination({ page, total, limit, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="mt-6 flex items-center justify-center gap-4 text-sm">
      <button
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="text-mute transition-colors hover:text-ink disabled:opacity-30"
      >
        이전
      </button>
      <span className="text-[13px]">{page} / {pages}</span>
      <button
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        className="text-mute transition-colors hover:text-ink disabled:opacity-30"
      >
        다음
      </button>
    </div>
  );
}
