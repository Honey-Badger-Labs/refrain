import { UKE_SHAPES, describeShape } from '../lib/chords.js';

const FRETS = 4;

/**
 * One ukulele chord box, drawn the way MelodyFlow draws them: four strings,
 * G C E A left to right, a dot where a finger goes, a ring over an open
 * string. Rendered as React elements, never markup. An unknown chord shows
 * its name only rather than a guessed shape.
 */
export function ChordBox({ name }: { name: string }) {
  const shape = UKE_SHAPES[name];
  if (!shape) {
    return <span className="pill pill-off px-2 py-1 text-xs">{name}</span>;
  }
  const gap = 14;
  const x = (s: number) => 10 + s * gap;
  const top = 22;
  const fretH = 14;
  return (
    <svg
      role="img"
      aria-label={describeShape(name) ?? name}
      viewBox="0 0 62 96"
      width={62}
      height={96}
      className="text-slate-300"
    >
      <text x={31} y={10} textAnchor="middle" fontSize={11} fill="currentColor" fontWeight={600}>
        {name}
      </text>
      <line x1={x(0)} x2={x(3)} y1={top} y2={top} stroke="currentColor" strokeWidth={2.5} />
      {Array.from({ length: FRETS }, (_, f) => (
        <line key={`f${f}`} x1={x(0)} x2={x(3)} y1={top + (f + 1) * fretH} y2={top + (f + 1) * fretH} stroke="#475569" />
      ))}
      {shape.map((_, s) => (
        <line key={`s${s}`} x1={x(s)} x2={x(s)} y1={top} y2={top + FRETS * fretH} stroke="#64748b" />
      ))}
      {shape.map((fret, s) =>
        fret === 0 ? (
          <circle key={`o${s}`} cx={x(s)} cy={top - 6} r={3} fill="none" stroke="currentColor" />
        ) : (
          <circle key={`d${s}`} cx={x(s)} cy={top + (fret - 0.5) * fretH} r={5} fill="#f59e0b" />
        ),
      )}
      {['G', 'C', 'E', 'A'].map((n, s) => (
        <text key={`n${s}`} x={x(s)} y={92} textAnchor="middle" fontSize={8} fill="#94a3b8">
          {n}
        </text>
      ))}
    </svg>
  );
}
