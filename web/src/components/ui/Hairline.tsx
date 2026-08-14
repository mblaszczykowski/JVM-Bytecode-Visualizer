interface HairlineProps {
  readonly className?: string;
}

export function Hairline({ className = '' }: HairlineProps) {
  return <div aria-hidden="true" className={`h-px shrink-0 bg-line ${className}`} />;
}
