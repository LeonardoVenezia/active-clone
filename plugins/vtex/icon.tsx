export function VtexIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-label="VTEX logo"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>VTEX</title>
      <rect fill="#F71963" height="20" rx="4" width="20" x="2" y="2" />
      <path
        d="M6.5 8l3.5 8 2-4.500L14 16l3.5-8"
        stroke="#fff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
