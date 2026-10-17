export function XubioIcon({ className }: { className?: string }) {
  // Official Xubio symbol from https://xubio.com/favicon.ico
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="Xubio" className={className} src="/brand-logos/xubio.png" />
  );
}
