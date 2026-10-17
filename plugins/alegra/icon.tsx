export function AlegraIcon({ className }: { className?: string }) {
  // Official Alegra isotipo from https://alegra.com/favicon.ico
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="Alegra" className={className} src="/brand-logos/alegra.png" />
  );
}
