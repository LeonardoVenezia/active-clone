export function ArcaIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-label="ARCA logo"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>ARCA</title>
      <rect fill="#1F5FA8" height="20" rx="4" width="20" x="2" y="2" />
      <path
        d="M7 17l5-10 5 10M9 13.5h6"
        stroke="#fff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
