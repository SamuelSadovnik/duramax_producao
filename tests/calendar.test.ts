import { describe, expect, it } from 'vitest';
import { expedienteEntre, proximoExpediente, situacaoTurno, somarDiasUteis, somarExpediente, subtrairExpediente, MIN_DIA } from '../shared/calendar';
import { deISOlocal } from '../shared/tz';
import { hora, quando } from '../shared/fmt';

const F = ['2026-11-02'];
const L = (s: string) => deISOlocal(s.slice(0, 10), s.slice(11, 16));

describe('calendário de expediente (horário de Brasília)', () => {
  it('dia útil tem 8h48 de produção', () => expect(MIN_DIA).toBe(528));

  it('pula almoço, noite e fim de semana', () => {
    const seg = L('2026-10-19T11:32');
    expect(hora(somarExpediente(seg, 28, F))).toBe('12:00');
    expect(hora(somarExpediente(seg, 29, F))).toBe('13:13');
    const ter = somarExpediente(seg, 300, F);
    expect(quando(ter, seg)).toBe('amanhã 07:44');
    const sexta = L('2026-10-23T17:00');
    expect(quando(somarExpediente(sexta, 60, F), sexta)).toBe('seg 26/10 08:00');
  });

  it('não conta feriado', () => {
    const sexta = L('2026-10-30T17:00');
    expect(quando(somarExpediente(sexta, 60, F), sexta)).toBe('ter 03/11 08:00');
  });

  it('próximo expediente de um sábado é segunda 07:30', () => {
    expect(quando(proximoExpediente(L('2026-10-17T10:00'), F), L('2026-10-17T10:00'))).toBe('seg 19/10 07:30');
  });

  it('expedienteEntre é o inverso de somarExpediente', () => {
    const a = L('2026-10-19T11:32');
    for (const m of [10, 300, 528, 1000, 2640]) expect(expedienteEntre(a, somarExpediente(a, m, F), F)).toBeCloseTo(m, 5);
  });

  it('subtrair atravessa feriado e fim de semana', () => {
    const t = L('2026-11-03T08:00');
    const s = subtrairExpediente(t, 60, F);
    expect(quando(s, t)).toBe('sex 30/10 17:00');
  });

  it('soma dias úteis sem contar o próprio dia', () => {
    expect(somarDiasUteis(L('2026-10-19T09:00'), 7, F)).toBe('2026-10-28');
    expect(somarDiasUteis(L('2026-10-17T10:00'), 1, F)).toBe('2026-10-19'); // sábado → segunda
    expect(somarDiasUteis(L('2026-10-29T18:00'), 2, F)).toBe('2026-11-03'); // pula fim de semana e feriado 02/11
  });

  it('situação do turno', () => {
    expect(situacaoTurno(L('2026-10-19T12:30'), F)).toBe('almoco');
    expect(situacaoTurno(L('2026-10-19T13:12'), F)).toBe('producao');
    expect(situacaoTurno(L('2026-10-19T17:30'), F)).toBe('fora');
    expect(situacaoTurno(L('2026-10-18T10:00'), F)).toBe('fora');
  });
});
