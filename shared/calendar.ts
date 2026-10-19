import { dataLocal, inicioDoDia, iso, minutoDoDia, partes, somarDias, deISOlocal } from './tz.js';

/** Expediente da produção e expedição: seg–sex, 07:30–12:00 e 13:12–17:30. */
export const JANELAS: [number, number][] = [
  [7 * 60 + 30, 12 * 60],
  [13 * 60 + 12, 17 * 60 + 30],
];
export const MIN_DIA = JANELAS.reduce((s, [a, b]) => s + b - a, 0); // 528 = 8h48
/** Escritório: seg–sex, 08:00–17:30. */
export const ESCRITORIO = { inicio: 8 * 60, fim: 17 * 60 + 30 };

const MS = 60_000;
export { iso };

const noDia = (d: Date, min: number) => new Date(inicioDoDia(d).getTime() + min * MS);

export function diaUtil(d: Date, feriados: string[]): boolean {
  const w = partes(d).semana;
  return w !== 0 && w !== 6 && !feriados.includes(iso(d));
}

/** Próximo instante dentro do expediente (o próprio instante se já estiver dentro). */
export function proximoExpediente(d: Date, feriados: string[]): Date {
  let t = new Date(d);
  for (let guard = 0; guard < 400; guard++) {
    if (diaUtil(t, feriados)) {
      const m = minutoDoDia(t);
      for (const [a, b] of JANELAS) {
        if (m < a) return noDia(t, a);
        if (m < b) return t;
      }
    }
    t = somarDias(t, 1);
  }
  return t;
}

/** Soma minutos de expediente a partir de um instante. */
export function somarExpediente(inicio: Date, minutos: number, feriados: string[]): Date {
  let t = proximoExpediente(inicio, feriados);
  let resta = Math.max(0, minutos);
  for (let guard = 0; guard < 5000; guard++) {
    const m = minutoDoDia(t);
    const jan = JANELAS.find(([a, b]) => m >= a && m < b);
    if (!jan) {
      t = proximoExpediente(new Date(t.getTime() + 1000), feriados);
      continue;
    }
    const disp = jan[1] - m;
    if (resta <= disp) return new Date(t.getTime() + resta * MS);
    resta -= disp;
    t = proximoExpediente(noDia(t, jan[1]), feriados);
  }
  return t;
}

/** Subtrai minutos de expediente (usado em testes e dados de exemplo). */
export function subtrairExpediente(fim: Date, minutos: number, feriados: string[]): Date {
  let t = new Date(fim);
  let resta = minutos;
  for (let guard = 0; guard < 5000 && resta > 0; guard++) {
    if (!diaUtil(t, feriados)) {
      t = new Date(inicioDoDia(t).getTime() - 1000);
      continue;
    }
    const m = minutoDoDia(t);
    const jan = [...JANELAS].reverse().find(([a, b]) => m > a && m <= b + 1e-6);
    if (!jan) {
      const ant = [...JANELAS].reverse().find(([, b]) => b <= m);
      t = ant ? noDia(t, ant[1]) : new Date(inicioDoDia(t).getTime() - 1000);
      continue;
    }
    const topo = Math.min(m, jan[1]);
    const usar = topo - jan[0];
    if (resta <= usar) return noDia(t, topo - resta);
    resta -= usar;
    t = new Date(noDia(t, jan[0]).getTime() - 1000);
  }
  return t;
}

/** Minutos de expediente entre dois instantes (0 se b <= a). */
export function expedienteEntre(a: Date, b: Date, feriados: string[]): number {
  if (b <= a) return 0;
  let total = 0;
  let d = inicioDoDia(a);
  for (let guard = 0; guard < 2000 && d <= b; guard++) {
    if (diaUtil(d, feriados)) {
      for (const [x, y] of JANELAS) {
        const ini = Math.max(noDia(d, x).getTime(), a.getTime());
        const fim = Math.min(noDia(d, y).getTime(), b.getTime());
        if (fim > ini) total += (fim - ini) / MS;
      }
    }
    d = somarDias(d, 1);
  }
  return total;
}

export type Turno = 'producao' | 'almoco' | 'fora';
export function situacaoTurno(d: Date, feriados: string[]): Turno {
  if (!diaUtil(d, feriados)) return 'fora';
  const m = minutoDoDia(d);
  if (m >= JANELAS[0][0] && m < JANELAS[0][1]) return 'producao';
  if (m >= JANELAS[1][0] && m < JANELAS[1][1]) return 'producao';
  if (m >= JANELAS[0][1] && m < JANELAS[1][0]) return 'almoco';
  return 'fora';
}

/** Fim do expediente (17:30) de uma data yyyy-mm-dd. */
export const fimDoDia = (data: string) => deISOlocal(data, '17:30');

export { dataLocal };
