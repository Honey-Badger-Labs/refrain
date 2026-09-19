/**
 * Inline icons.
 *
 * Drawn here rather than pulled from a pack: five shapes do not justify a
 * dependency, and inline SVG keeps the strict CSP honest (no external assets).
 */
const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function PlayIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} fill="currentColor" stroke="none">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

export function PauseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} fill="currentColor" stroke="none">
      <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg {...base}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg {...base}>
      <path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 20h16" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...base}>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg {...base}>
      <path d="M12 3v13M12 3L8 7m4-4l4 4M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5" />
    </svg>
  );
}

export function FlagIcon() {
  return (
    <svg {...base}>
      <path d="M5 21V4m0 0h11l-2 4 2 4H5" />
    </svg>
  );
}

export function SkipIcon({ dir = 1 }: { dir?: 1 | -1 }) {
  return (
    <svg {...base} style={dir === -1 ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M5 5l9 7-9 7zM18 5v14" />
    </svg>
  );
}
