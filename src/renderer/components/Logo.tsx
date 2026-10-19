/** Geometric cube mark, teal outline (no logo asset existed in the project). */
export function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 3l18 10.2v21.6L24 45 6 34.8V13.2L24 3z" stroke="var(--cyan)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M24 3v21m0 0l18-10.8M24 24L6 13.2" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M24 24v21" stroke="var(--teal)" strokeWidth="2" />
      <path d="M24 14l8 4.6v9.2L24 32.4l-8-4.6v-9.2L24 14z" fill="var(--accent)" fillOpacity=".22" />
    </svg>
  );
}
