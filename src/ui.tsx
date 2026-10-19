import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from './store';
import type { Estado, OP, Pedido } from '../shared/types';
import { statusPedido, situacaoPrazo, opsDoPedido } from '../shared/engine';
import { quando } from '../shared/fmt';

const P: Record<string, string> = {
  upload: 'M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  search: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm10.5 3-5.2-5.2',
  x: 'M6 6l12 12M18 6 6 18',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  up: 'M12 19V5m0 0-6 6m6-6 6 6',
  down: 'M12 5v14m0 0 6-6m-6 6-6-6',
  top: 'M5 4h14M12 20V9m0 0-5 5m5-5 5 5',
  play: 'M7 5v14l12-7L7 5Z',
  check: 'M5 12.5 10 17.5 19 7',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  alert: 'M12 9v4m0 3.5h.01M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  truck: 'M3 6h11v10H3zM14 10h4l3 3v3h-7M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  box: 'M21 8 12 3 3 8m18 0-9 5m9-5v8l-9 5m0-8L3 8m9 5v8M3 8v8l9 5',
  flask: 'M9 3h6M10 3v6L4.5 18.5A1.6 1.6 0 0 0 5.9 21h12.2a1.6 1.6 0 0 0 1.4-2.5L14 9V3M7 15h10',
  tv: 'M3 5h18v12H3zM8 21h8M12 17v4',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Zm0 0v5h5',
  bolt: 'M13 3 4 14h7l-1 7 9-11h-7l1-7Z',
  info: 'M12 16v-5m0-3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
};

export function Icon({ n, s = 16, w = 2 }: { n: keyof typeof P | string; s?: number; w?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[n]} />
    </svg>
  );
}

export const STATUS_PED: Record<string, { label: string; cor: string }> = {
  pcp: { label: 'Aguardando PCP', cor: 'var(--warn)' },
  fila: { label: 'Na fila de produção', cor: 'var(--muted)' },
  producao: { label: 'Em produção', cor: 'var(--info)' },
  pronto: { label: 'Pronto p/ expedição', cor: 'var(--ok)' },
  expedido: { label: 'Expedido', cor: 'var(--fg-2)' },
};

export function PrazoChip({ p }: { p: Pedido }) {
  const { e, agenda, agora } = useApp();
  const s = situacaoPrazo(e, p, agenda.pedidos.get(p.id), agora);
  if (s.tipo === 'sem') return null;
  const cls = s.tipo === 'ok' ? 'ok' : s.tipo === 'risco' ? 'warn' : 'crit';
  return (
    <span className={`chip ${cls}`}>
      {s.tipo === 'ok' ? <Icon n="check" s={12} w={2.6} /> : <Icon n="alert" s={12} />}
      {s.texto}
    </span>
  );
}

export function estimativaTexto(e: Estado, p: Pedido, est: Date | undefined, agora: Date) {
  const st = statusPedido(e, p);
  if (st === 'pcp') return 'aguarda análise do PCP';
  if (st === 'expedido') return `expedido ${quando(new Date(p.expedidoEm!), agora)}`;
  if (st === 'pronto') return `pronto ${quando(new Date(p.prontoEm!), agora)}`;
  return est ? quando(est, agora) : '—';
}

export function ProgressoOPs({ e, p }: { e: Estado; p: Pedido }) {
  const { agenda } = useApp();
  const ops = opsDoPedido(e, p.id);
  if (!ops.length) return null;
  const done = ops.filter((o) => o.status === 'concluida').length;
  const run = ops.filter((o) => o.status === 'producao');
  const late = run.filter((o) => agenda.ops.get(o.id)?.atrasada).length;
  const tot = ops.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="bar" style={{ flex: 1 }} aria-hidden="true">
        {done > 0 && <i className="done" style={{ width: `${(done / tot) * 100}%` }} />}
        {run.length - late > 0 && <i className="run" style={{ width: `${((run.length - late) / tot) * 100}%` }} />}
        {late > 0 && <i className="late" style={{ width: `${(late / tot) * 100}%` }} />}
      </div>
      <span className="num muted" style={{ fontSize: 11.5 }}>
        {done}/{tot} OP{tot > 1 ? 's' : ''}
      </span>
    </div>
  );
}

export function Modal({ onClose, children, wide, label }: { onClose: () => void; children: ReactNode; wide?: boolean; label: string }) {
  useEffect(() => {
    const h = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </>
  );
}

export function Toasts() {
  const { toasts, fecharToast } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tipo ?? ''}`} role={t.tipo === 'erro' ? 'alert' : undefined}>
          <span>{t.texto}</span>
          {t.desfazer && (
            <button
              onClick={() => {
                t.desfazer!();
                fecharToast(t.id);
              }}
            >
              Desfazer
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Tooltip simples que segue o ponteiro. */
export function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; c: ReactNode } | null>(null);
  const el = tip ? (
    <div className="tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 290), top: tip.y + 14 }}>
      {tip.c}
    </div>
  ) : null;
  const bind = (c: ReactNode) => ({
    onPointerMove: (ev: React.PointerEvent) => setTip({ x: ev.clientX, y: ev.clientY, c }),
    onPointerLeave: () => setTip(null),
  });
  return { el, bind, hide: () => setTip(null) };
}

export const nomeOP = (e: Estado, o: OP) => e.produtos[o.produtoId]?.nome ?? o.produtoId;

export function PedChips({ e, o, max = 3 }: { e: Estado; o: OP; max?: number }) {
  const { abrirPedido } = useApp();
  return (
    <>
      {o.alocacoes.slice(0, max).map((a) => {
        const p = e.pedidos.find((x) => x.id === a.pedidoId);
        if (!p) return null;
        return (
          <button key={a.pedidoId} className="chip info" style={{ border: 0, cursor: 'pointer' }} onClick={() => abrirPedido(p.id)} title={p.fantasia}>
            #{p.numero}
          </button>
        );
      })}
      {o.alocacoes.length > max && <span className="chip">+{o.alocacoes.length - max}</span>}
    </>
  );
}
