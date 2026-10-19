-- Prazo de entrega calculado: N dias úteis a partir da entrada do pedido no sistema.
-- A "Data Previsão" do PDF não é usada para o prazo (o pedido pode ser digitado bem antes de ser aprovado).
alter table config add column prazo_dias_uteis integer not null default 7 check (prazo_dias_uteis between 1 and 60);
