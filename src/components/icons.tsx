import type { SVGProps } from 'react';
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, viewBox: '0 0 24 24' };
type P = SVGProps<SVGSVGElement>;
export const Icon = {
  Globe: (p: P) => (<svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></svg>),
  Tree: (p: P) => (<svg {...base} {...p}><path d="M5 20V14M12 20V10M19 20v-8M5 14h7M12 10V4M12 10h7v2" /><circle cx="12" cy="4" r="1.4" /></svg>),
  Book: (p: P) => (<svg {...base} {...p}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20M8 7h8M8 11h6" /></svg>),
  Lens: (p: P) => (<svg {...base} {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21M8 10.5h5M10.5 8v5" /></svg>),
  Person: (p: P) => (<svg {...base} {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" /></svg>),
  Chart: (p: P) => (<svg {...base} {...p}><path d="M4 20V4M4 20h16M7 15l4-4 3 3 5-6" /></svg>),
  Flask: (p: P) => (<svg {...base} {...p}><path d="M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7.5 15h9" /></svg>),
  Info: (p: P) => (<svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>),
  Play: (p: P) => (<svg {...base} {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>),
  Pause: (p: P) => (<svg {...base} {...p}><path d="M8 5v14M16 5v14" strokeWidth="3" /></svg>),
  Step: (p: P) => (<svg {...base} {...p}><path d="M6 5v14l9-7zM18 5v14" /></svg>),
  Reset: (p: P) => (<svg {...base} {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></svg>),
  Camera: (p: P) => (<svg {...base} {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>),
  Branch: (p: P) => (<svg {...base} {...p}><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10M18 10c0 4-6 3-12 7" /></svg>),
  Plus: (p: P) => (<svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>),
  X: (p: P) => (<svg {...base} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>),
  Download: (p: P) => (<svg {...base} {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>),
  Upload: (p: P) => (<svg {...base} {...p}><path d="M12 20V9M7 14l5-5 5 5M5 4h14" /></svg>),
  Eye: (p: P) => (<svg {...base} {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>),
  Trash: (p: P) => (<svg {...base} {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>),
  Chevron: (p: P) => (<svg {...base} {...p}><path d="M9 6l6 6-6 6" /></svg>),
  Network: (p: P) => (<svg {...base} {...p}><circle cx="5" cy="12" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><circle cx="12" cy="12" r="2" /><path d="M7 12h3M14 11l3.3-3.6M14 13l3.3 3.6" /></svg>),
  Sound: (p: P) => (<svg {...base} {...p}><path d="M4 9v6h4l5 4V5L8 9zM17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11" /></svg>),
  Settings: (p: P) => (<svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" /></svg>),
};

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect x="0.5" y="0.5" width="39" height="39" rx="9" stroke="#ecc678" strokeOpacity="0.35" />
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M${9 + i * 2.2} ${31 - i * 5}h${22 - i * 4.4}`} stroke={i % 2 ? '#e0936d' : '#ecc678'} strokeWidth="2.2" strokeLinecap="round" />
      ))}
      <path d="M20 6v3" stroke="#ecc678" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
