import { useEffect, useState } from "react";
import { clampNumber, parseNumberDraft, stepNumber } from "./numberField";

type Props = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  title?: string;
  "aria-label"?: string;
};

export function NumberField({ value, onChange, min, max, step, title, "aria-label": ariaLabel }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(null);
  }, [value, focused]);

  const shown = draft ?? (Number.isFinite(value) ? String(value) : "");

  const commit = (raw: string, clamp: boolean) => {
    const parsed = parseNumberDraft(raw);
    if (parsed == null) {
      setDraft(null);
      return;
    }
    onChange(clamp ? clampNumber(parsed, min, max) : parsed);
  };

  return (
    <input
      className="num"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      min={min}
      max={max}
      step={step}
      title={title}
      aria-label={ariaLabel}
      value={shown}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseNumberDraft(raw);
        if (parsed != null) onChange(parsed);
      }}
      onBlur={(e) => {
        setFocused(false);
        commit(e.target.value, true);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
          return;
        }
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const base = parseNumberDraft(draft ?? shown) ?? (Number.isFinite(value) ? value : 0);
        const next = stepNumber(base, e.key === "ArrowUp" ? 1 : -1, step ?? 1, min, max);
        onChange(next);
        setDraft(null);
      }}
    />
  );
}
