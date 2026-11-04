// Monaco is excluded to avoid a third-party CDN during offline tests.
export function CodeEditor({
  value,
  onChange,
}: {
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <textarea
      aria-label="Code editor fixture"
      onChange={(e) => onChange?.(e.target.value)}
      value={value || ""}
    />
  );
}
