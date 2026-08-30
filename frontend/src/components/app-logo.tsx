export function AppLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="11" y="3.5" width="9.5" height="11" rx="2" />
      <circle cx="5" cy="18.5" r="1.7" fill="currentColor" stroke="none" />
      <path d="M5 14.2a4.6 4.6 0 0 1 4.2 4.1" />
      <path d="M5 10a8.6 8.6 0 0 1 7.6 7.2" />
    </svg>
  );
}
