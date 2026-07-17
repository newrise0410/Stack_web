// Task 6에서 실제 구현으로 교체되는 스텁
export default function TrackingCsvModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30" onClick={onClose}>
      <div className="bg-paper p-6 text-sm">CSV 업로드는 준비 중입니다.</div>
    </div>
  );
}
