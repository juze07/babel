import { useEffect, useMemo, useRef, useState } from 'react';
import { useSim } from '../../store/store';
import { renderTerrain, renderTerritories } from './terrain';
import { Seg } from '../../components/ui';
import type { FrameView } from '../../simulation/engine/views';

export type MapLayer = 'languages' | 'population' | 'plain';

interface Props {
  onPickRoute?: (i: number) => void;
  pickMode?: 'trade' | null;
  onPickSettlement?: (id: number) => void;
}

const S = 4; // terrain pixels per grid cell

export function WorldMap({ onPickSettlement, pickMode }: Props) {
  const world = useSim((s) => s.world);
  const frame = useSim((s) => s.frame);
  const selection = useSim((s) => s.selection);
  const select = useSim((s) => s.select);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layer, setLayer] = useState<MapLayer>('languages');
  const [showAgents, setShowAgents] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const cam = useRef({ x: 0, y: 0, k: 1, fitted: false });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const frameRef = useRef<FrameView | null>(null);
  const prevPos = useRef<Map<number, [number, number]>>(new Map());
  const curPos = useRef<Map<number, [number, number]>>(new Map());
  const frameTime = useRef(0);
  const arcs = useRef<{ a: number; b: number; ok: number; t: number }[]>([]);
  const terrain = useMemo(() => (world ? renderTerrain(world, S) : null), [world]);

  const langKey = frame ? frame.settlements.map((s) => `${s.lang}:${s.pop > 0 ? 1 : 0}`).join(',') + '|' + frame.langs.map((l) => l.color).join(',') : '';
  const territories = useMemo(() => {
    if (!world || !frame) return null;
    const colors = new Map(frame.langs.map((l) => [l.id, l.color]));
    return renderTerritories(world, frame.settlements, (id) => colors.get(id) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, langKey]);

  // ingest frames: remember previous positions for smooth interpolation
  useEffect(() => {
    if (!frame) return;
    frameRef.current = frame;
    const p = frame.pos;
    const next = new Map<number, [number, number]>();
    for (let i = 0; i < p.length; i += 5) next.set(p[i + 4], [p[i], p[i + 1]]);
    prevPos.current = curPos.current.size ? curPos.current : next;
    curPos.current = next;
    frameTime.current = performance.now();
    const now = performance.now();
    for (const c of frame.convs) arcs.current.push({ a: c[0], b: c[1], ok: c[2], t: now });
    arcs.current = arcs.current.filter((a) => now - a.t < 1400).slice(-60);
  }, [frame]);

  // fit camera
  const fit = () => {
    const wrap = wrapRef.current;
    if (!wrap || !world) return;
    const k = Math.min(wrap.clientWidth / (world.W * S), wrap.clientHeight / (world.H * S));
    cam.current = { k, x: (wrap.clientWidth - world.W * S * k) / 2, y: (wrap.clientHeight - world.H * S * k) / 2, fitted: true };
  };
  useEffect(() => { cam.current.fitted = false; }, [world]);

  // render loop
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = canvasRef.current, wrap = wrapRef.current;
      const f = frameRef.current;
      if (!cv || !wrap || !terrain || !world) return;
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cam.current.fitted = false; }
      if (!cam.current.fitted) fit();
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#18303f';
      ctx.fillRect(0, 0, w, h);
      const { x: ox, y: oy, k } = cam.current;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(k, k);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(terrain, 0, 0);
      if (layer === 'languages' && territories) {
        ctx.globalAlpha = 0.85;
        ctx.drawImage(territories, 0, 0, world.W * S, world.H * S);
        ctx.globalAlpha = 1;
      }
      if (!f) { ctx.restore(); return; }
      const now = performance.now();
      const G = (v: number) => v * S + S / 2;
      const langColor = new Map(f.langs.map((l) => [l.id, l.color]));
      // routes
      if (showRoutes) {
        f.routes.forEach((r, i) => {
          const p = r.path;
          ctx.beginPath();
          for (let j = 0; j < p.length; j += 2) (j ? ctx.lineTo(G(p[j]), G(p[j + 1])) : ctx.moveTo(G(p[j]), G(p[j + 1])));
          const sel = selection?.kind === 'route' && selection.id === i;
          ctx.lineWidth = (sel ? 3.2 : r.trade ? 2.2 : 1.4) / Math.sqrt(k);
          ctx.setLineDash(r.trade ? [6 / k + 3, 4 / k + 2] : [2 / k + 1, 4 / k + 2]);
          ctx.strokeStyle = r.blocked ? 'rgba(181,74,58,0.85)' : r.trade ? 'rgba(236,198,120,0.95)' : 'rgba(251,248,242,0.55)';
          if (sel) ctx.strokeStyle = '#fff';
          ctx.stroke();
          ctx.setLineDash([]);
          if (r.blocked) {
            const mid = Math.floor(p.length / 4) * 2;
            const mx = G(p[mid]), my = G(p[mid + 1]), s = 5;
            ctx.strokeStyle = '#b54a3a'; ctx.lineWidth = 2.4 / Math.sqrt(k);
            ctx.beginPath(); ctx.moveTo(mx - s, my - s); ctx.lineTo(mx + s, my + s); ctx.moveTo(mx + s, my - s); ctx.lineTo(mx - s, my + s); ctx.stroke();
          }
        });
      }
      // conversation arcs between settlements
      for (const a of arcs.current) {
        const sa = f.settlements[a.a], sb = f.settlements[a.b];
        if (!sa || !sb) continue;
        const age = (now - a.t) / 1400;
        if (age > 1) continue;
        const x1 = G(sa.x), y1 = G(sa.y), x2 = G(sb.x), y2 = G(sb.y);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.25;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2);
        ctx.strokeStyle = a.ok ? `rgba(236,198,120,${0.7 * (1 - age)})` : `rgba(224,147,109,${0.55 * (1 - age)})`;
        ctx.lineWidth = 1.6 / Math.sqrt(k);
        ctx.stroke();
      }
      // agents
      if (showAgents) {
        const lerp = Math.min(1, (now - frameTime.current) / 140);
        const pos = f.pos;
        const r = Math.max(0.9, 1.6 / Math.sqrt(k));
        for (let i = 0; i < pos.length; i += 5) {
          const id = pos[i + 4];
          const cur = curPos.current.get(id), prev = prevPos.current.get(id) ?? cur;
          if (!cur || !prev) continue;
          let x = prev[0] + (cur[0] - prev[0]) * lerp, y = prev[1] + (cur[1] - prev[1]) * lerp;
          const settled = pos[i + 3] >= 0;
          if (settled) { x += Math.sin(now / 1700 + id) * 0.35; y += Math.cos(now / 2100 + id * 1.7) * 0.35; }
          const lang = pos[i + 2];
          ctx.beginPath();
          ctx.arc(G(x), G(y), settled ? r : r * 1.4, 0, Math.PI * 2);
          ctx.fillStyle = lang >= 0 ? langColor.get(lang) ?? '#eee' : 'rgba(250,248,240,0.85)';
          ctx.fill();
          if (!settled) { ctx.strokeStyle = '#fbf8f2'; ctx.lineWidth = 0.8 / Math.sqrt(k); ctx.stroke(); }
          if (selection?.kind === 'agent' && selection.id === id || f.follow === id) {
            ctx.beginPath(); ctx.arc(G(x), G(y), r * 3.2, 0, Math.PI * 2);
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / Math.sqrt(k); ctx.stroke();
          }
        }
      }
      // settlements
      for (const s of f.settlements) {
        const x = G(s.x), y = G(s.y);
        const rad = (layer === 'population' ? 3 + Math.sqrt(s.pop) * 1.4 : 2.4 + Math.sqrt(s.pop) * 0.55) / Math.sqrt(k) * 1.6;
        const col = s.lang >= 0 ? langColor.get(s.lang) ?? '#999' : '#bbb';
        if (layer === 'population') {
          ctx.beginPath(); ctx.arc(x, y, rad * 1.8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(214,160,61,0.18)'; ctx.fill();
          // capacity ring
          ctx.beginPath(); ctx.arc(x, y, rad * 1.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, s.pop / Math.max(1, s.capacity)));
          ctx.strokeStyle = s.pop > s.capacity ? '#b54a3a' : '#ecc678'; ctx.lineWidth = 2 / Math.sqrt(k); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fillStyle = s.pop > 0 ? '#fbf8f2' : 'rgba(251,248,242,0.4)';
        ctx.fill();
        ctx.lineWidth = 2.6 / Math.sqrt(k);
        ctx.strokeStyle = s.pop > 0 ? col : '#888';
        ctx.stroke();
        if (s.isolated) { ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, rad + 4 / Math.sqrt(k), 0, Math.PI * 2); ctx.strokeStyle = '#b54a3a'; ctx.stroke(); ctx.setLineDash([]); }
        if (selection?.kind === 'settlement' && selection.id === s.id) {
          ctx.beginPath(); ctx.arc(x, y, rad + 6 / Math.sqrt(k), 0, Math.PI * 2);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6 / Math.sqrt(k); ctx.stroke();
        }
      }
      ctx.restore();
      // labels in screen space (crisp)
      ctx.textAlign = 'center';
      for (const s of f.settlements) {
        const x = ox + (s.x * S + S / 2) * k, y = oy + (s.y * S + S / 2) * k;
        const rad = (2.4 + Math.sqrt(s.pop) * 0.55) * 1.6 * Math.sqrt(k);
        ctx.font = `500 ${Math.round(11 + Math.min(4, k * 2))}px Fraunces, Georgia, serif`;
        const label = s.name;
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(22,32,46,0.75)'; ctx.strokeText(label, x, y - rad - 6);
        ctx.fillStyle = s.pop > 0 ? '#fbf8f2' : 'rgba(251,248,242,0.55)';
        ctx.fillText(label, x, y - rad - 6);
        ctx.font = '500 10px "JetBrains Mono", monospace';
        ctx.strokeText(String(s.pop), x, y + rad + 13);
        ctx.fillStyle = 'rgba(236,198,120,0.95)';
        ctx.fillText(String(s.pop), x, y + rad + 13);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [terrain, territories, world, layer, showAgents, showRoutes, selection]);

  // interaction
  const toWorld = (ev: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { x, y, k } = cam.current;
    return { gx: ((ev.clientX - r.left - x) / k - S / 2) / S, gy: ((ev.clientY - r.top - y) / k - S / 2) / S, sx: ev.clientX - r.left, sy: ev.clientY - r.top };
  };
  const hit = (gx: number, gy: number) => {
    const f = frameRef.current;
    if (!f) return null;
    const k = cam.current.k;
    for (const s of f.settlements) {
      const rad = ((2.4 + Math.sqrt(s.pop) * 0.55) * 1.6) / Math.sqrt(k) / S + 0.8;
      if (Math.hypot(s.x - gx, s.y - gy) < rad) return { kind: 'settlement' as const, id: s.id };
    }
    let best = -1, bd = (2.2 / (k * S)) ** 2 + 0.2;
    for (let i = 0; i < f.pos.length; i += 5) {
      const d = (f.pos[i] - gx) ** 2 + (f.pos[i + 1] - gy) ** 2;
      if (d < bd) { bd = d; best = f.pos[i + 4]; }
    }
    if (best >= 0) return { kind: 'agent' as const, id: best };
    // routes
    let ri = -1, rd = 1.2;
    f.routes.forEach((r, i) => {
      for (let j = 0; j + 3 < r.path.length; j += 2) {
        const d = segDist(gx, gy, r.path[j], r.path[j + 1], r.path[j + 2], r.path[j + 3]);
        if (d < rd) { rd = d; ri = i; }
      }
    });
    if (ri >= 0) return { kind: 'route' as const, id: ri };
    return null;
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const c = cam.current;
    const nk = Math.max(0.3, Math.min(8, c.k * Math.exp(-e.deltaY * 0.0015)));
    c.x = mx - ((mx - c.x) * nk) / c.k;
    c.y = my - ((my - c.y) * nk) / c.k;
    c.k = nk;
  };

  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className={drag.current ? 'dragging' : ''}
        onWheel={onWheel}
        onMouseDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; }}
        onMouseMove={(e) => {
          if (drag.current) {
            const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true;
            cam.current.x += dx; cam.current.y += dy;
            drag.current.x = e.clientX; drag.current.y = e.clientY;
            setTip(null);
            return;
          }
          const p = toWorld(e);
          const h = hit(p.gx, p.gy);
          const f = frameRef.current;
          if (!h || !f) { setTip(null); return; }
          let text = '';
          if (h.kind === 'settlement') {
            const s = f.settlements[h.id];
            const l = f.langs.find((x) => x.id === s.lang);
            text = `${s.name} · ${s.pop} people${l ? ' · ' + l.name : ''}`;
          } else if (h.kind === 'agent') text = `Agent #${h.id} — click to inspect`;
          else { const r = f.routes[h.id]; text = `${r.trade ? 'Trade route' : 'Route'} ${f.settlements[r.a].name} – ${f.settlements[r.b].name}${r.blocked ? ' (blocked)' : ''}`; }
          setTip({ x: p.sx, y: p.sy, text });
        }}
        onMouseUp={(e) => {
          const moved = drag.current?.moved;
          drag.current = null;
          if (moved) return;
          const p = toWorld(e);
          const h = hit(p.gx, p.gy);
          if (pickMode && h?.kind === 'settlement') { onPickSettlement?.(h.id); return; }
          select(h);
        }}
        onMouseLeave={() => { drag.current = null; setTip(null); }}
      />
      {tip && <div className="map-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
      <div className="map-tools">
        <Seg value={layer} onChange={setLayer} options={[{ v: 'languages', label: 'Languages' }, { v: 'population', label: 'Population' }, { v: 'plain', label: 'Terrain' }]} />
        <div className="seg">
          <button className={showAgents ? 'on' : ''} onClick={() => setShowAgents(!showAgents)}>Agents</button>
          <button className={showRoutes ? 'on' : ''} onClick={() => setShowRoutes(!showRoutes)}>Routes</button>
          <button onClick={() => { cam.current.fitted = false; }}>Fit</button>
        </div>
      </div>
      {pickMode && <div className="map-banner"><div className="eyebrow">Trade route</div><div style={{ fontFamily: 'var(--serif)', fontSize: 16 }}>Click two settlements to connect them</div></div>}
    </div>
  );
}

function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
