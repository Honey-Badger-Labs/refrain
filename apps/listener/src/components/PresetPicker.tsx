import type { Catalogue } from '@refrain/catalogue';

/**
 * Style and voice.
 *
 * Only combinations that actually have a published track are offered, and a
 * pair with no track is shown disabled rather than hidden — a listener who saw
 * "Folk" yesterday should be told it is missing today, not left wondering.
 */
export function PresetPicker({
  catalogue,
  chunkId,
  styleId,
  voiceId,
  onChange,
}: {
  catalogue: Catalogue;
  chunkId: string;
  styleId: string;
  voiceId: string;
  onChange: (next: { styleId: string; voiceId: string }) => void;
}) {
  const tracks = catalogue.tracks.filter((t) => t.chunkId === chunkId);
  const presets = catalogue.presets.filter((p) => tracks.some((t) => t.presetId === p.id));

  const hasPair = (style: string, voice: string) =>
    presets.some((p) => p.styleId === style && p.voiceId === voice);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Group
        label="Style"
        options={catalogue.styles.map((style) => ({
          id: style.id,
          name: style.name,
          available: presets.some((p) => p.styleId === style.id),
        }))}
        selected={styleId}
        onSelect={(next) => {
          const voice = hasPair(next, voiceId)
            ? voiceId
            : (presets.find((p) => p.styleId === next)?.voiceId ?? voiceId);
          onChange({ styleId: next, voiceId: voice });
        }}
      />
      <Group
        label="Voice"
        options={catalogue.voices.map((voice) => ({
          id: voice.id,
          name: voice.name,
          available: presets.some((p) => p.voiceId === voice.id),
        }))}
        selected={voiceId}
        onSelect={(next) => {
          const style = hasPair(styleId, next)
            ? styleId
            : (presets.find((p) => p.voiceId === next)?.styleId ?? styleId);
          onChange({ styleId: style, voiceId: next });
        }}
      />
    </div>
  );
}

function Group({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: Array<{ id: string; name: string; available: boolean }>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={!option.available}
            aria-pressed={option.id === selected}
            onClick={() => onSelect(option.id)}
            className={`pill ${option.id === selected ? 'pill-on' : 'pill-off'} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}
