import { partes, iso } from './tz.js';

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_LONGOS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export const nf = (n: number, d = 0) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtVol = (n: number, u = 'L') => `${nf(n, n % 1 && n < 100 ? 1 : 0)} ${u}`;

export function fmtDur(min: number): string {
  const m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const s = min < 0 ? '−' : '';
  if (!h) return `${s}${r}min`;
  return `${s}${h}h${String(r).padStart(2, '0')}`;
}

const z = (n: number) => String(n).padStart(2, '0');
export const hora = (d: Date) => {
  const p = partes(d);
  return `${z(p.h)}:${z(p.m)}`;
};
export const dataCurta = (d: Date) => {
  const p = partes(d);
  return `${z(p.dia)}/${z(p.mes + 1)}`;
};
export const diaSemana = (d: Date) => DIAS[partes(d).semana];
export const diaSemanaLongo = (d: Date) => DIAS_LONGOS[partes(d).semana];

export const mesmoDia = (a: Date, b: Date) => iso(a) === iso(b);

/** "hoje 15:40", "amanhã 08:10", "qua 21/10 15:40" */
export function quando(d: Date, agora = new Date()): string {
  const amanha = new Date(agora.getTime() + 86_400_000);
  if (mesmoDia(d, agora)) return `hoje ${hora(d)}`;
  if (mesmoDia(d, amanha)) return `amanhã ${hora(d)}`;
  return `${diaSemana(d)} ${dataCurta(d)} ${hora(d)}`;
}

export const dataISOparaBR = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—');

export const titulo = (s: string) =>
  (s || '')
    .toLowerCase()
    .split(' ')
    .map((w) => (w.length <= 2 && !/^[a-z]$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase());

export const minParaHM = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
export function hmParaMin(s: string): number | null {
  const m = s.trim().match(/^(\d{1,3})(?::(\d{1,2}))?$/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0);
}
