export function NotFound({ reason, onHome }: { reason: string; onHome: () => void }) {
  return (
    <div className="card p-6">
      <h1 className="text-lg font-semibold">Nothing here</h1>
      <p className="mt-2 text-sm text-slate-400">{reason}</p>
      <button
        type="button"
        onClick={onHome}
        className="mt-4 rounded-xl bg-ember-500 px-4 py-2 text-sm font-medium text-night-950"
      >
        Go to the library
      </button>
    </div>
  );
}
