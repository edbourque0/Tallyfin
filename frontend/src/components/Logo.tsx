import { useId } from 'react';

/** Tallyfin mark: a jellyfish whose tentacles are a tally of five. Colours follow the theme's ribbon. */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  // Unique per instance: a shared id breaks when the first copy sits in a display:none subtree (the sidebar on phones).
  const gid = `tallyfin-gradient-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 128 128" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="22" y1="18" x2="106" y2="118">
          <stop offset="0" style={{ stopColor: 'var(--logo-from)' }} />
          <stop offset="1" style={{ stopColor: 'var(--logo-to)' }} />
        </linearGradient>
      </defs>
      <path
        d="M22 66 C22 36 41 18 64 18 C87 18 106 36 106 66 C98 72 90 72 84 68 C78 73 70 73 64 68 C58 73 50 73 44 68 C38 72 30 72 22 66 Z"
        fill={`url(#${gid})`}
      />
      <g stroke={`url(#${gid})`} strokeWidth="8" strokeLinecap="round" fill="none">
        <path d="M40 78 V112" />
        <path d="M56 78 V116" />
        <path d="M72 78 V116" />
        <path d="M88 78 V112" />
        <path d="M30 108 L98 86" />
      </g>
    </svg>
  );
}

/** Wordmark: "Tallyfin" in Geist 600 followed by a ribbon square dot. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={`wordmark ${className ?? ''}`}>Tallyfin</span>;
}
