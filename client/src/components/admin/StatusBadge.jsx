import { ORDER_STATUS_LABEL } from '../../lib/admin.js';

export default function StatusBadge({ status }) {
  const muted = status === 'cancelled';
  return (
    <span
      className={`inline-block whitespace-nowrap border px-2 py-0.5 text-[11px] ${
        muted ? 'border-line text-faint' : 'border-ink text-ink'
      }`}
    >
      {ORDER_STATUS_LABEL[status] || status}
    </span>
  );
}
