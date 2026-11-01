import { type ReactNode, useState } from 'react';
import { Icon } from './icons';
import type { MetricDef } from '../simulation/metrics/metrics';
import { useSim } from '../store/store';
import type { LangSummary } from '../simulation/engine/views';

export function Panel({ title, eyebrow, right, children, className = '', bodyClass = '', pad = true }: { title?: ReactNode; eyebrow?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; pad?: boolean }) {
  return (
    <div className={`panel ${className}`}>
      {(title || right) && (
        <div className="panel-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h3>{title}</h3>}
          </div>
          {right}
        </div>
      )}
      <div className={pad ? `panel-body ${bodyClass}` : bodyClass}>{children}</div>
    </div>
  );
}

export function Stat({ label, value, sub, info }: { label: ReactNode; value: ReactNode; sub?: ReactNode; info?: MetricDef | string }) {
  return (
    <div className="stat">
      <div className="l">{label}{info && <InfoTip def={info} />}</div>
      <div className="v">{value}</div>
      {sub && <div className="d">{sub}</div>}
    </div>
  );
}

export function InfoTip({ def }: { def: MetricDef | string }) {
  return (
    <span className="info">
      <Icon.Info />
      <span className="pop">
        {typeof def === 'string' ? def : (
          <>
            <b>{def.label}</b> <span className={`tag ${def.kind}`} style={{ marginLeft: 4 }}>{def.kind === 'direct' ? 'direct measure' : 'proxy'}</span>
            <div style={{ marginTop: 6 }}>{def.meaning}</div>
            <div style={{ marginTop: 6 }}><code>{def.formula}</code></div>
            <div style={{ marginTop: 6, opacity: 0.8 }}>Limitation: {def.limits}</div>
          </>
        )}
      </span>
    </span>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { v: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (<button key={t.v} className={t.v === value ? 'on' : ''} onClick={() => onChange(t.v)}>{t.label}</button>))}
    </div>
  );
}

export function LangChip({ lang, onClick }: { lang: Pick<LangSummary, 'id' | 'name' | 'color' | 'fate'> | undefined; onClick?: () => void }) {
  const focus = useSim((s) => s.focusLanguage);
  if (!lang) return <span className="muted small">no language yet</span>;
  return (
    <span className={`lang-chip ${lang.fate !== 'alive' ? 'dead' : ''}`} onClick={onClick ?? (() => focus(lang.id))} title={lang.fate !== 'alive' ? lang.fate : 'Open in language inspector'}>
      <span className="swatch" style={{ background: lang.color }} />{lang.name}
    </span>
  );
}

export function Bar({ value, color }: { value: number; color?: string }) {
  return <div className="bar"><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} /></div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Modal({ title, sub, onClose, children, foot }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal fade-in">
        <div className="modal-head">
          <div><h2>{title}</h2>{sub && <div className="muted small" style={{ marginTop: 4 }}>{sub}</div>}</div>
          <button className="btn icon ghost" onClick={onClose}><Icon.X /></button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

export function Collapsible({ title, children, open: o = false }: { title: ReactNode; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(o);
  return (
    <div>
      <button className="btn ghost sm" onClick={() => setOpen(!open)} style={{ paddingLeft: 0 }}>
        <Icon.Chevron style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} /> {title}
      </button>
      {open && <div style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, hint, format }: { label: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; hint?: ReactNode; format?: (v: number) => string }) {
  return (
    <label className="field">
      <span className="row between"><span>{label}</span><span className="mono">{format ? format(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
