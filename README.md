# Duramax Produção

Sistema de produção da Duramax Tintas e Vernizes. O pedido percorre o caminho inteiro num só lugar:

1. **Comercial** importa o PDF do *Pedido de Venda* do ERP. O sistema lê o cliente, o prazo e todos os itens.
2. **PCP** decide item por item o que sai do **estoque** e o que vira **OP**. As embalagens do mesmo produto (linha + cor) são agrupadas em lotes, e a sobra de OPs que ainda não começaram é aproveitada.
3. **TV da produção** mostra o que está sendo produzido, o que vem a seguir e o que ficou pronto.
4. **Gerente de produção** inicia e finaliza cada OP pelo tablet. Se passar do tempo padrão, informa o motivo.
5. Quando a última OP do pedido termina, ele é **liberado para a expedição**.
6. **Desempenho** compara o tempo real de cada OP com o padrão e mostra onde o tempo foi perdido.

A estimativa de entrega considera a fila de prioridade, o tempo padrão de cada produto, quantas OPs a fábrica costuma rodar ao mesmo tempo e o expediente da produção:

| Expediente | Horário |
|---|---|
| Produção e expedição | seg a sex, 07:30–12:00 e 13:12–17:30 |
| Escritório | seg a sex, 08:00–17:30 |

Os feriados são cadastrados em **Parâmetros** e não contam no cálculo.

## Perfis

| Perfil | O que faz |
|---|---|
| Administrador | Tudo, inclusive cadastrar usuários |
| PCP | Vê tudo, decide estoque/OP, prioridade, parâmetros, pode operar OPs |
| Comercial | Vê tudo, importa pedidos, mexe na prioridade, marca expedição |
| Gerente de produção | Chão de fábrica: inicia e finaliza OPs |
| Produção (TV) | Só o painel da fábrica |

Cada pessoa tem o seu login. A sessão dura 30 dias e é renovada a cada dia de uso, então a TV e o tablet não precisam entrar de novo toda hora.

## Tecnologia

- **Interface:** React + Vite + TypeScript (`src/`)
- **API:** [Hono](https://hono.dev) em Node (`server/`), publicada como função da Vercel (`api/index.ts`)
- **Banco:** Postgres. Em produção usamos o **Neon**; no desenvolvimento, Postgres no Docker.
- **Regras de negócio** (`shared/`): funções puras usadas pelo servidor e pela interface. Cobrem o calendário de expediente, o leitor do PDF, o agrupamento em lotes, a agenda e as ações.

```
api/            função da Vercel (encaminha /api/* para o Hono)
server/         app Hono, autenticação, leitura/gravação do estado, rotas
shared/         regras de negócio (sem dependência de banco nem de tela)
src/            telas
db/migrations/  SQL do banco, aplicado em ordem por npm run db:migrar
scripts/        migração e criação de usuário pela linha de comando
tests/          testes (vitest)
```

Cada alteração (importar, liberar, iniciar OP…) roda dentro de uma transação no servidor: carrega o estado, aplica a regra de `shared/` e grava só o que mudou. Depois sobe um número de versão. As telas consultam essa versão a cada 4 segundos e recarregam quando ela muda. É assim que a TV e o tablet se atualizam sozinhos.

## Rodar no seu computador

Requisitos: **Node 20+** e **Docker Desktop**.

```bash
npm install
cp .env.example .env          # no Windows: copy .env.example .env
npm run db:up                 # sobe o Postgres no Docker
npm run db:migrar             # cria as tabelas
npm run criar-usuario -- --usuario samuel --nome "Samuel" --perfil admin --senha "uma-senha-forte"
npm run dev                   # interface em http://localhost:5173 (API em :3001)
```

Abra http://localhost:5173 e entre com o usuário criado. Os demais usuários (TV, gerente, PCP, comercial) são criados pela tela **Usuários**.

Outros comandos:

| Comando | Para quê |
|---|---|
| `npm test` | testes das regras (calendário, leitor de PDF, lotes, OPs) |
| `npm run typecheck` | checagem de tipos |
| `npm run build` | gera a interface em `dist/` |
| `npm run preview` | serve `dist/` + API juntos em http://localhost:3001 |

## Publicar na Vercel com Neon

1. **GitHub:** suba este repositório (ver abaixo).
2. **Vercel:** *Add New → Project*, importe o repositório. A Vercel detecta o Vite; o `vercel.json` já define build, saída e as rotas da API.
3. **Banco:** no projeto da Vercel, *Storage → Create Database → Neon* (ou *Marketplace → Neon*) e conecte ao projeto. A integração cria a variável `DATABASE_URL`. Se aparecer só `POSTGRES_URL`, o sistema também aceita.
4. **Segredo de sessão:** em *Settings → Environment Variables*, crie `AUTH_SECRET` com um valor aleatório longo:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
5. **Criar as tabelas no Neon** (uma vez, e de novo sempre que houver migração nova). No seu computador, coloque a `DATABASE_URL` do Neon no `.env` (ou rode com a variável na frente) e execute:
   ```bash
   npm run db:migrar
   npm run criar-usuario -- --usuario samuel --nome "Samuel" --perfil admin --senha "uma-senha-forte"
   ```
6. **Deploy:** faça *Redeploy* na Vercel (ou um novo push). Acesse a URL do projeto e entre.

Para conferir a instalação, abra `https://SEU-PROJETO.vercel.app/api/saude`. Ele mostra cada item e o que falta:

```json
{ "ok": true, "segredo": "ok", "banco": "ok", "tabelas": "ok", "usuarios": "ok (5)" }
```

Se algum item vier como `faltando: ...`, a própria mensagem diz o que fazer (criar `AUTH_SECRET`, rodar `npm run db:migrar`, criar o administrador).

### Subir para o GitHub

Crie um repositório vazio chamado `duramax_producao` (sem README) e rode, nesta pasta:

```bash
git remote add origin https://github.com/SamuelSadovnik/duramax_producao.git
git push -u origin main
```

## Commits

Cada mudança vai num commit próprio, no formato `tipo(área): descrição`:

- `feat` funcionalidade nova · `fix` correção · `refactor` reorganização sem mudar comportamento
- `test` testes · `docs` documentação · `chore` configuração, build, deploy
- áreas usadas: `regras`, `banco`, `api`, `web`, `deploy`

O GitHub Actions (`.github/workflows/ci.yml`) roda tipos, testes, migrações e build a cada push.
