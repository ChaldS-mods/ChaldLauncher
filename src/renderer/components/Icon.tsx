const P: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  cube: 'M12 2l9 5v10l-9 5-9-5V7l9-5zM12 12l9-5M12 12v10M12 12L3 7',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  puzzle: 'M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4h2a2 2 0 100-4H6V6h4V4z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
  play: 'M7 4l13 8-13 8V4z',
  stop: 'M6 6h12v12H6z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  folder: 'M3 6h6l2 2h10v11H3z',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  x: 'M6 6l12 12M18 6L6 18',
  min: 'M5 12h14',
  max: 'M5 5h14v14H5z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  refresh: 'M20 5v5h-5M4 19v-5h5M5.6 9A8 8 0 0118.4 7L20 10M18.4 15A8 8 0 015.6 17L4 14',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  chevron: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  alert: 'M12 4l9 16H3L12 4zM12 10v5M12 18h.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  wrench: 'M14 6a4 4 0 005 5l-9 9a2 2 0 01-3-3l9-9a4 4 0 00-2-2z',
};

export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? ''} />
    </svg>
  );
}
