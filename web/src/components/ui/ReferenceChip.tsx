interface ReferenceChipProps {
  readonly label: string;
  readonly onAccent?: boolean;
}

export function ReferenceChip({ label, onAccent = false }: ReferenceChipProps) {
  return (
    <span
      data-testid="ref-chip"
      className={`shrink-0 rounded-chip px-1.5 py-px font-mono text-label ${
        onAccent ? 'bg-accent-fill text-accent-text' : 'bg-raised text-fg-2'
      }`}
    >
      {label}
    </span>
  );
}
