-- Estrutura inicial do sistema de produção.
-- Itens e eventos do pedido e alocações da OP ficam em JSONB: são sempre lidos e gravados
-- junto com o registro pai e não precisam de consultas próprias.

create extension if not exists pgcrypto;

create table usuarios (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  usuario        text not null unique check (usuario ~ '^[a-z0-9._-]{2,40}$'),
  senha_hash     text not null,
  perfil         text not null check (perfil in ('admin', 'comercial', 'pcp', 'gerente', 'tv')),
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  ultimo_acesso  timestamptz
);

create table produtos (
  id             text primary key,                 -- código base de fábrica (linha.cor), ex. 600.1000
  nome           text not null,
  linha          text not null,
  unidade        text not null default 'L' check (unidade in ('L', 'kg')),
  lote           numeric(12, 2) not null check (lote > 0),
  tempo_min      integer not null check (tempo_min > 0),
  pendente       boolean not null default false,  -- criado na importação, parâmetros ainda não revisados
  atualizado_em  timestamptz not null default now()
);

create table pedidos (
  id             text primary key,                 -- 'p' + número do pedido
  numero         text not null unique,
  cliente        text not null default '',
  fantasia       text not null default '',
  cidade         text not null default '',
  uf             text not null default '',
  vendedor       text not null default '',
  transportadora text not null default '',
  emissao        date,
  previsao       date,                             -- prazo combinado com o cliente
  importado_em   timestamptz not null default now(),
  pcp_em         timestamptz,
  pronto_em      timestamptz,
  expedido_em    timestamptz,
  ordem          double precision,                 -- posição na fila de prioridade (null = fora da fila)
  itens          jsonb not null default '[]'::jsonb,
  eventos        jsonb not null default '[]'::jsonb,
  atualizado_em  timestamptz not null default now()
);
create index pedidos_ativos_idx on pedidos (ordem) where expedido_em is null;
create index pedidos_expedido_idx on pedidos (expedido_em);

create table ops (
  id               text primary key,
  numero           integer not null unique,
  produto_id       text not null references produtos (id),
  lote             numeric(12, 2) not null,
  tempo_padrao_min integer not null,
  alocacoes        jsonb not null default '[]'::jsonb,   -- [{ pedidoId, volume }]
  status           text not null check (status in ('fila', 'producao', 'concluida')),
  criada_em        timestamptz not null default now(),
  inicio           timestamptz,
  fim              timestamptz,
  real_min         integer,
  motivo           text,
  obs              text,
  iniciada_por     text,
  finalizada_por   text,
  atualizado_em    timestamptz not null default now()
);
create index ops_abertas_idx on ops (status) where status <> 'concluida';
create index ops_fim_idx on ops (fim);

create table config (
  id             integer primary key default 1 check (id = 1),
  capacidade     integer not null default 2,
  tolerancia_pct integer not null default 10,
  feriados       jsonb not null default '[]'::jsonb,
  versao         bigint not null default 0      -- sobe a cada alteração; as telas recarregam quando muda
);

insert into config (id, capacidade, tolerancia_pct, feriados)
values (1, 2, 10, '["2026-11-02","2026-11-20","2026-12-25","2027-01-01"]'::jsonb);
