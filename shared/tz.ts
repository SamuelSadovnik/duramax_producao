/**
 * Horário de Brasília (America/Sao_Paulo). Desde 2019 não há horário de verão,
 * então o fuso é fixo em UTC−3. Todas as contas de expediente usam este relógio,
 * independente do fuso do servidor (a Vercel roda em UTC) ou do navegador.
 */
export const OFFSET_MIN = -180;
const DESLOC = OFFSET_MIN * 60_000;
const DIA = 86_400_000;

export interface Partes {
  ano: number;
  mes: number; // 0–11
  dia: number;
  h: number;
  m: number;
  s: number;
  semana: number; // 0 = domingo
}

export function partes(d: Date): Partes {
  const x = new Date(d.getTime() + DESLOC);
  return {
    ano: x.getUTCFullYear(),
    mes: x.getUTCMonth(),
    dia: x.getUTCDate(),
    h: x.getUTCHours(),
    m: x.getUTCMinutes(),
    s: x.getUTCSeconds(),
    semana: x.getUTCDay(),
  };
}

/** Instante correspondente a uma data local de Brasília + minutos desde a meia-noite. */
export function dataLocal(ano: number, mes: number, dia: number, minutos = 0): Date {
  return new Date(Date.UTC(ano, mes, dia) - DESLOC + minutos * 60_000);
}

export function inicioDoDia(d: Date): Date {
  const p = partes(d);
  return dataLocal(p.ano, p.mes, p.dia);
}

export const somarDias = (d: Date, n: number) => new Date(inicioDoDia(d).getTime() + n * DIA);

/** Minutos desde a meia-noite (com fração de segundos). */
export function minutoDoDia(d: Date): number {
  const p = partes(d);
  return p.h * 60 + p.m + p.s / 60;
}

/** yyyy-mm-dd no horário de Brasília. */
export function iso(d: Date): string {
  const p = partes(d);
  return `${p.ano}-${String(p.mes + 1).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
}

/** Converte yyyy-mm-dd + HH:MM (horário de Brasília) em instante. */
export function deISOlocal(data: string, horaMin = '00:00'): Date {
  const [a, m, d] = data.split('-').map(Number);
  const [h, mi] = horaMin.split(':').map(Number);
  return dataLocal(a, m - 1, d, h * 60 + (mi || 0));
}

/** Valor para <input type="datetime-local"> no horário de Brasília. */
export function paraInputLocal(d: Date): string {
  const p = partes(d);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${p.ano}-${z(p.mes + 1)}-${z(p.dia)}T${z(p.h)}:${z(p.m)}`;
}

export function deInputLocal(s: string): Date {
  const [data, hm] = s.split('T');
  return deISOlocal(data, hm ?? '00:00');
}

export const mesmoDia = (a: Date, b: Date) => iso(a) === iso(b);
