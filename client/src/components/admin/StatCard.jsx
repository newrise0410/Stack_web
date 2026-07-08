export default function StatCard({ label, value, sub }) {
  return (
    <div className="border border-line p-5">
      <p className="text-[12px] text-mute">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-[12px] text-faint">{sub}</p>}
    </div>
  );
}
