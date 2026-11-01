export const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const fx = (x: number | null | undefined, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(d));
export const yr = (tick: number) => `${Math.floor(tick / 4)}`;
export const yearOf = (tick: number) => Math.floor(tick / 4);
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const EVENT_COLORS: Record<string, string> = {
  birth: '#7f9474', split: '#c0643c', merge: '#6d84a3', extinct: '#2b2b2b', grammar: '#8a6bb0', sound: '#d6a03d', borrowing: '#3f8f8a',
  semantic: '#b56b94', loss: '#9c8f7a', contact: '#3f8f8a', migration: '#5d7d99', environment: '#a7884f', intervention: '#b54a3a', world: '#16202e', agent: '#888', lexicon: '#7f9474', isolation: '#5d7d99',
};
export const EVENT_LABELS: Record<string, string> = {
  birth: 'Emergence', split: 'Divergence', merge: 'Convergence', extinct: 'Extinction', grammar: 'Grammar', sound: 'Sound change', borrowing: 'Borrowing', semantic: 'Semantic shift',
  loss: 'Vocabulary loss', contact: 'Contact', migration: 'Migration', environment: 'Environment', intervention: 'Intervention', world: 'World', agent: 'Agent', lexicon: 'Lexicon', isolation: 'Isolation',
};
