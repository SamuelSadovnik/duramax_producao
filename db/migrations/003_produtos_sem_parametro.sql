-- Produto novo entra sem lote e sem tempo: o PCP informa os valores reais antes de liberar o pedido.
-- Até aqui a importação preenchia valores estimados por linha; os que ninguém revisou são apagados.
alter table produtos alter column lote drop not null;
alter table produtos alter column tempo_min drop not null;
alter table produtos drop constraint if exists produtos_lote_check;
alter table produtos drop constraint if exists produtos_tempo_min_check;
alter table produtos add constraint produtos_lote_check check (lote is null or lote > 0);
alter table produtos add constraint produtos_tempo_min_check check (tempo_min is null or tempo_min > 0);

update produtos set lote = null, tempo_min = null where pendente;

-- "pendente" deixa de ser usado: sem parâmetro = lote ou tempo nulos
alter table produtos drop column pendente;
