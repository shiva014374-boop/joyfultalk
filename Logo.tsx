export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="18" fill="var(--ink-3)" />
        <path d="M14 30c0-9.4 7.6-17 17-17h2c9.4 0 17 7.6 17 17s-7.6 17-17 17h-6l-9 6v-8.2C15.6 41.6 14 36.1 14 30z" fill="var(--apricot)" />
        <circle cx="25" cy="29" r="3" fill="var(--ink-1)" />
        <circle cx="39" cy="29" r="3" fill="var(--ink-1)" />
        <path d="M25 36c4 3.5 10 3.5 14 0" stroke="var(--ink-1)" strokeWidth="3" fill="none" strokeLinecap="round" />
      </svg>
      <span className="logo-word">
        Joyful <em>Talk</em>
      </span>
    </span>
  )
}
