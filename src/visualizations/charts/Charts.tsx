import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/** Track an element's pixel width so SVG text is never stretched. */
function useWidth(ref: React.RefObject<HTMLDivElement | null>, fallback = 600) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { const cw = Math.round(e.contentRect.width); if (cw > 0) setW(cw); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export interface Series { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean }

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function LineChart({ x, series, height = 160, yMax, yMin = 0, percent = false, xLabel = 'year', format, markers }: {
  x: number[]; series: Series[]; height?: number; yMax?: number; yMin?: number; percent?: boolean; xLabel?: string; format?: (v: number) => string; markers?: { x: number; label: string; color?: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = useWidth(ref), H = height, pl = 38, pr = 10, pt = 10, pb = 22;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const max = yMax ?? niceMax(Math.max(...all, 0.0001));
  const min = yMin;
  const x0 = x[0] ?? 0, x1 = x[x.length - 1] ?? 1;
  const sx = (v: number) => pl + ((v - x0) / Math.max(1e-9, x1 - x0)) * (W - pl - pr);
  const sy = (v: number) => pt + (1 - (v - min) / Math.max(1e-9, max - min)) * (H - pt - pb);
  const fmt = format ?? ((v: number) => (percent ? `${Math.round(v * 100)}%` : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(v < 10 ? 2 : 1)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min));
  const xticks = useMemo(() => {
    const n = W < 360 ? 3 : 5;
    return Array.from({ length: n }, (_, i) => x0 + ((x1 - x0) * i) / (n - 1));
  }, [x0, x1, W]);
  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${sx(x[i]).toFixed(1)},${sy(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    if (!x.length) return;
    let bi = 0, bd = Infinity;
    x.forEach((v, i) => { const d = Math.abs(sx(v) - px); if (d < bd) { bd = d; bi = i; } });
    setHover(bi);
  };
  return (
    <div ref={ref} style={{ position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pl} x2={W - pr} y1={sy(t)} y2={sy(t)} stroke="#e4dccd" strokeDasharray={i === 0 ? '' : '2 3'} vectorEffect="non-scaling-stroke" />
            <text x={pl - 6} y={sy(t) + 3} textAnchor="end" fontSize="9.5" fill="#8d8676" fontFamily="JetBrains Mono">{fmt(t)}</text>
          </g>
        ))}
        {xticks.map((t, i) => (
          <text key={i} x={sx(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === xticks.length - 1 ? 'end' : 'middle'} fontSize="9.5" fill="#8d8676" fontFamily="JetBrains Mono">{Math.round(t)}{i === xticks.length - 1 ? ` ${xLabel}` : ''}</text>
        ))}
        {markers?.map((m, i) => (
          <g key={i}>
            <line x1={sx(m.x)} x2={sx(m.x)} y1={pt} y2={H - pb} stroke={m.color ?? '#c0643c'} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity={0.6} />
          </g>
        ))}
        {series.map((s, i) => (
          <path key={s.key} d={paths[i]} fill="none" stroke={s.color} strokeWidth={1.8} strokeDasharray={s.dashed ? '4 3' : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ))}
        {hover !== null && x[hover] !== undefined && (
          <g>
            <line x1={sx(x[hover])} x2={sx(x[hover])} y1={pt} y2={H - pb} stroke="#1d2533" opacity={0.25} vectorEffect="non-scaling-stroke" />
            {series.map((s) => (s.values[hover] !== null && s.values[hover] !== undefined ? <circle key={s.key} cx={sx(x[hover])} cy={sy(s.values[hover] as number)} r={3} fill={s.color} /> : null))}
          </g>
        )}
      </svg>
      {hover !== null && x[hover] !== undefined && (
        <div className="chart-tip" style={{ left: `${(sx(x[hover]) / W) * 100}%`, top: 4, transform: sx(x[hover]) > W * 0.6 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}>
          <div style={{ opacity: 0.7, marginBottom: 2 }}>{xLabel} {Math.round(x[hover])}</div>
          {series.map((s) => (
            <div className="r" key={s.key}><span className="swatch" style={{ background: s.color }} />{s.label}: <b>{s.values[hover] === null || s.values[hover] === undefined ? '—' : fmt(s.values[hover] as number)}</b></div>
          ))}
        </div>
      )}
      {series.filter((s) => !s.label.startsWith('seed ')).length > 1 && (
        <div className="row wrap chart-legend">
          {series.filter((s) => !s.label.startsWith('seed ')).map((s) => <span key={s.key} className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: s.color, height: 3, width: 14, borderRadius: 2, opacity: s.dashed ? 0.7 : 1 }} />{s.label}</span>)}
        </div>
      )}
    </div>
  );
}

export function StackedArea({ x, layers, height = 140, xLabel = 'year' }: { x: number[]; layers: { label: string; color: string; values: number[] }[]; height?: number; xLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const W = useWidth(ref), H = height, pl = 30, pr = 10, pt = 6, pb = 20;
  const x0 = x[0] ?? 0, x1 = x[x.length - 1] ?? 1;
  const sx = (v: number) => pl + ((v - x0) / Math.max(1e-9, x1 - x0)) * (W - pl - pr);
  const sy = (v: number) => pt + (1 - v) * (H - pt - pb);
  const cum = x.map((_, i) => { let s = 0; const tot = layers.reduce((a, l) => a + (l.values[i] ?? 0), 0) || 1; return layers.map((l) => { const lo = s; s += (l.values[i] ?? 0) / tot; return [lo, s]; }); });
  return (
    <div ref={ref} style={{ position: 'relative' }} onMouseLeave={() => setHover(null)} onMouseMove={(e) => {
      const r = ref.current!.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      let bi = 0, bd = Infinity; x.forEach((v, i) => { const d = Math.abs(sx(v) - px); if (d < bd) { bd = d; bi = i; } }); setHover(bi);
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        {layers.map((l, li) => {
          if (!x.length) return null;
          let d = `M${sx(x[0])},${sy(cum[0][li][0])}`;
          x.forEach((v, i) => { d += `L${sx(v)},${sy(cum[i][li][1])}`; });
          for (let i = x.length - 1; i >= 0; i--) d += `L${sx(x[i])},${sy(cum[i][li][0])}`;
          return <path key={l.label} d={d + 'Z'} fill={l.color} opacity={0.88} />;
        })}
        {[0, 0.5, 1].map((t) => <text key={t} x={pl - 5} y={sy(t) + 3} fontSize="9.5" textAnchor="end" fill="#8d8676" fontFamily="JetBrains Mono">{t * 100}%</text>)}
        <text x={W - pr} y={H - 5} fontSize="9.5" textAnchor="end" fill="#8d8676" fontFamily="JetBrains Mono">{Math.round(x1)} {xLabel}</text>
        <text x={pl} y={H - 5} fontSize="9.5" fill="#8d8676" fontFamily="JetBrains Mono">{Math.round(x0)}</text>
        {hover !== null && <line x1={sx(x[hover])} x2={sx(x[hover])} y1={pt} y2={H - pb} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(sx(x[hover]) / W) * 100}%`, top: 4, transform: sx(x[hover]) > W * 0.6 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}>
          <div style={{ opacity: 0.7 }}>{xLabel} {Math.round(x[hover])}</div>
          {layers.map((l) => <div className="r" key={l.label}><span className="swatch" style={{ background: l.color }} />{l.label}: <b>{Math.round((l.values[hover] ?? 0) * 100)}%</b></div>)}
        </div>
      )}
      <div className="row wrap chart-legend">{layers.map((l) => <span key={l.label} className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: l.color }} />{l.label}</span>)}</div>
    </div>
  );
}

export function Heatmap({ labels, colors, matrix, onCell, format = (v) => `${Math.round(v * 100)}`, size = 30, legend }: {
  labels: string[]; colors?: string[]; matrix: number[][]; onCell?: (i: number, j: number) => void; format?: (v: number) => string; size?: number; legend?: ReactNode;
}) {
  const n = labels.length;
  const lw = 92;
  const col = (v: number) => {
    const t = Math.max(0, Math.min(1, v));
    const a = [245, 240, 230], b = [192, 100, 60], c = [29, 37, 51];
    const m = t < 0.6 ? a.map((x, i) => x + (b[i] - x) * (t / 0.6)) : b.map((x, i) => x + (c[i] - x) * ((t - 0.6) / 0.4));
    return `rgb(${m.map(Math.round).join(',')})`;
  };
  return (
    <div style={{ overflow: 'auto' }}>
      <svg width={lw + n * size + 4} height={lw + n * size + 4} style={{ display: 'block' }}>
        {labels.map((l, i) => (
          <g key={i}>
            <text x={lw - 6} y={lw + i * size + size / 2 + 4} textAnchor="end" fontSize="11" fontFamily="Fraunces, serif" fill="#1d2533">{l}</text>
            <text transform={`translate(${lw + i * size + size / 2 + 4}, ${lw - 6}) rotate(-50)`} fontSize="11" fontFamily="Fraunces, serif" fill="#1d2533">{l}</text>
            {colors && <rect x={lw - 4} y={lw + i * size + 3} width={3} height={size - 6} fill={colors[i]} />}
          </g>
        ))}
        {matrix.map((row, i) => row.map((v, j) => (
          <g key={`${i}-${j}`} onClick={() => onCell?.(i, j)} style={{ cursor: onCell ? 'pointer' : undefined }}>
            <rect x={lw + j * size} y={lw + i * size} width={size - 1.5} height={size - 1.5} rx={3} fill={i === j ? '#e9e1d2' : col(v)} />
            <text x={lw + j * size + size / 2 - 0.75} y={lw + i * size + size / 2 + 3.5} textAnchor="middle" fontSize="9.5" fontFamily="JetBrains Mono" fill={v > 0.55 && i !== j ? '#fbf8f2' : '#3d4757'}>{i === j ? '·' : format(v)}</text>
          </g>
        )))}
      </svg>
      {legend}
    </div>
  );
}

export function Sparkline({ values, color = '#c0643c', height = 26, width = 90, max }: { values: number[]; color?: string; height?: number; width?: number; max?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const m = max ?? Math.max(...values, 1e-9);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - (v / m) * (height - 4)).toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

export function DistBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const tot = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div style={{ display: 'flex', height: 12, borderRadius: 4, overflow: 'hidden', border: '1px solid #ddd3c1' }}>
        {parts.map((p) => <div key={p.label} title={`${p.label}: ${Math.round((p.value / tot) * 100)}%`} style={{ width: `${(p.value / tot) * 100}%`, background: p.color }} />)}
      </div>
      <div className="row wrap" style={{ gap: 10, marginTop: 6 }}>
        {parts.map((p) => <span key={p.label} className="tiny row" style={{ gap: 4 }}><span className="swatch" style={{ background: p.color }} />{p.label} <span className="mono muted">{Math.round((p.value / tot) * 100)}%</span></span>)}
      </div>
    </div>
  );
}

export const ORDER_COLORS: Record<string, string> = { SOV: '#c0643c', SVO: '#7f9474', VSO: '#d6a03d', VOS: '#6d84a3', OVS: '#8a6bb0', OSV: '#3f8f8a' };
export const PALETTE = ['#c0643c', '#7f9474', '#d6a03d', '#6d84a3', '#8a6bb0', '#3f8f8a', '#b56b94', '#9c8f7a', '#2d4a5c', '#e0936d'];
