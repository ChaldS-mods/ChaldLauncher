import type { LauncherId } from '../../shared/launchers';
import { Icon } from './Icon';

/**
 * Simple stand-ins for the launchers' icons (drawn here, no files, no network). They only hint at the
 * launcher's colours and shape; they are not the official logos.
 */
export function LauncherIcon({ id, size = 40 }: { id: LauncherId | 'custom'; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': true, focusable: false } as const;
  switch (id) {
    case 'prism':
      return (
        <svg {...common}>
          <rect width="32" height="32" rx="7" fill="#1f2638" />
          <polygon points="14,7 23,24 5,24" fill="#2b3550" stroke="#eef2fb" strokeWidth="1.8" strokeLinejoin="round" />
          <line x1="3" y1="15" x2="11.5" y2="15" stroke="#eef2fb" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="19" y1="14" x2="29" y2="9" stroke="#ff5c6c" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="19.6" y1="16.4" x2="29" y2="16.4" stroke="#ffd24a" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="20" y1="19" x2="29" y2="23" stroke="#4ad8ff" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'multimc':
      return (
        <svg {...common}>
          <rect width="32" height="32" rx="7" fill="#2f5fa8" />
          <polygon points="16,6 26,11.5 16,17 6,11.5" fill="#8fb8f0" />
          <polygon points="6,11.5 16,17 16,27 6,21.5" fill="#e9f1ff" />
          <polygon points="26,11.5 16,17 16,27 26,21.5" fill="#5d8fd6" />
        </svg>
      );
    case 'polymc':
      return (
        <svg {...common}>
          <rect width="32" height="32" rx="7" fill="#6d3fc9" />
          <polygon points="16,5 25.5,10.5 25.5,21.5 16,27 6.5,21.5 6.5,10.5" fill="none" stroke="#f2ebff" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="16" cy="16" r="3.4" fill="#f2ebff" />
        </svg>
      );
    case 'modrinth':
      return (
        <svg {...common}>
          <rect width="32" height="32" rx="7" fill="#15241c" />
          <circle cx="16" cy="16" r="8" fill="none" stroke="#1bd96a" strokeWidth="3.4" />
          <path d="M16 8.2l5 3.4-5 1.8z" fill="#1bd96a" />
          <circle cx="16" cy="16" r="2.2" fill="#1bd96a" />
        </svg>
      );
    case 'curseforge':
      return (
        <svg {...common}>
          <rect width="32" height="32" rx="7" fill="#f16436" />
          <path d="M6 9.5h20v4.2h-5.4c-1.3 1.1-1.3 3.2 0 5.1H24V23H8.6v-4.2h2.8c1.3-1.9 1.3-4 0-5.1H6z" fill="#fff4ee" />
        </svg>
      );
    case 'official':
      return (
        <svg {...common}>
          <rect width="32" height="32" rx="7" fill="#1d2a1d" />
          <polygon points="16,5 27,10.5 16,16 5,10.5" fill="#62b23a" />
          <polygon points="5,10.5 16,16 16,28 5,22.5" fill="#8a5a2c" />
          <polygon points="27,10.5 16,16 16,28 27,22.5" fill="#6b4220" />
          <polygon points="5,10.5 16,16 16,18.6 5,13.1" fill="#4f9a2b" />
          <polygon points="27,10.5 16,16 16,18.6 27,13.1" fill="#3f7f22" />
        </svg>
      );
    default:
      return (
        <span className="limp-folder" style={{ width: size, height: size }}>
          <Icon name="folder" size={Math.round(size * 0.6)} />
        </span>
      );
  }
}
