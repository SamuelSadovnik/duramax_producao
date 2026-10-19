import { useEffect, useState } from 'react';
import { api, ErroApi } from './api';
import { useApp } from './store';
import { Icon, Modal, Vazio } from './ui';
import { PERFIS, type Perfil, type Usuario } from '../shared/types';
import { quando } from '../shared/fmt';

const nomePerfil = (p: Perfil) => PERFIS.find((x) => x.k === p)?.l ?? p;
const DESCRICAO: Record<Perfil, string> = {
  admin: 'Tudo, inclusive usuários',
  comercial: 'Importa pedidos, prioridade e expedição',
  pcp: 'Decide estoque/OP, prioridade e parâmetros',
  gerente: 'Chão de fábrica: inicia e finaliza OPs',
  tv: 'Só o painel da produção',
};

export function UsuariosView() {
  const { usuario: eu, toast, agora } = useApp();
  const [lista, setLista] = useState<Usuario[] | null>(null);
  const [novo, setNovo] = useState({ nome: '', usuario: '', perfil: 'gerente' as Perfil, senha: '' });
  const [enviando, setEnviando] = useState(false);
  const [senhaDe, setSenhaDe] = useState<Usuario | null>(null);

  const carregar = () => api.usuarios().then((r) => setLista(r.usuarios)).catch((e) => toast({ texto: e.message, tipo: 'erro' }));
  useEffect(() => {
    carregar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function criar(ev: React.FormEvent) {
    ev.preventDefault();
    setEnviando(true);
    try {
      await api.criarUsuario(novo);
      toast({ texto: `Usuário ${novo.usuario} criado. Passe a senha para a pessoa.`, tipo: 'ok' });
      setNovo({ nome: '', usuario: '', perfil: novo.perfil, senha: '' });
      carregar();
    } catch (e) {
      toast({ texto: e instanceof ErroApi ? e.message : 'Erro ao criar.', tipo: 'erro' });
    }
    setEnviando(false);
  }

  async function editar(u: Usuario, d: Parameters<typeof api.editarUsuario>[1], msg: string) {
    try {
      await api.editarUsuario(u.id, d);
      toast({ texto: msg, tipo: 'ok' });
      carregar();
    } catch (e) {
      toast({ texto: e instanceof ErroApi ? e.message : 'Erro ao salvar.', tipo: 'erro' });
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Usuários</h1>
          <p>Cada pessoa tem o seu login. O perfil define o que ela vê e pode fazer. A TV da fábrica usa um usuário com perfil “Produção (TV)”.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Novo usuário</h2></div>
        <form className="usr-form" onSubmit={criar}>
          <label>Nome<input id="nu-nome" className="input" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} required maxLength={80} /></label>
          <label>
            Usuário (login)
            <input id="nu-usuario" className="input" value={novo.usuario} onChange={(e) => setNovo({ ...novo, usuario: e.target.value.toLowerCase().replace(/\s/g, '') })} required pattern="[a-z0-9._\-]{2,40}" title="Letras minúsculas, números, ponto ou hífen" />
          </label>
          <label>
            Perfil
            <select id="nu-perfil" className="select" value={novo.perfil} onChange={(e) => setNovo({ ...novo, perfil: e.target.value as Perfil })}>
              {PERFIS.map((p) => <option key={p.k} value={p.k}>{p.l}</option>)}
            </select>
          </label>
          <label>Senha inicial<input id="nu-senha" className="input" type="text" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} required minLength={8} placeholder="mínimo 8 caracteres" /></label>
          <button className="btn pri" type="submit" disabled={enviando}>Criar</button>
        </form>
        <p className="usr-nota">{DESCRICAO[novo.perfil]}.</p>
      </section>

      <section className="panel flush">
        <div className="scroll-x">
          <table className="t cartoes-tab" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Nome</th>
                <th style={{ width: 150 }}>Usuário</th>
                <th style={{ width: 230 }}>Perfil</th>
                <th style={{ width: 150 }}>Último acesso</th>
                <th style={{ width: 120 }}>Situação</th>
                <th className="r" style={{ width: 250 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista?.map((u) => (
                <tr key={u.id} style={{ opacity: u.ativo ? 1 : 0.55 }}>
                  <td className="cel-tit"><span className="nome">{u.nome}</span>{u.id === eu.id && <span className="chip info" style={{ marginLeft: 8 }}>você</span>}</td>
                  <td className="mono" data-l="Usuário">{u.usuario}</td>
                  <td data-l="Perfil">
                    <select
                      id={`perfil-${u.id}`}
                      aria-label={`Perfil de ${u.nome}`}
                      className="select sm"
                      value={u.perfil}
                      disabled={u.id === eu.id}
                      onChange={(e) => editar(u, { perfil: e.target.value as Perfil }, `${u.nome} agora é ${nomePerfil(e.target.value as Perfil)}.`)}
                    >
                      {PERFIS.map((p) => <option key={p.k} value={p.k}>{p.l}</option>)}
                    </select>
                  </td>
                  <td className="num muted nw" data-l="Último acesso">{u.ultimoAcesso ? quando(new Date(u.ultimoAcesso), agora) : 'nunca entrou'}</td>
                  <td data-l="Situação">{u.ativo ? <span className="chip ok">ativo</span> : <span className="chip">desativado</span>}</td>
                  <td className="cel-larga">
                    <div className="acoes">
                    <button className="btn sm" onClick={() => setSenhaDe(u)}><Icon n="chave" s={14} /> Nova senha</button>
                    {u.id !== eu.id && (
                      <button className={`btn sm${u.ativo ? ' danger' : ''}`} onClick={() => editar(u, { ativo: !u.ativo }, u.ativo ? `${u.nome} desativado.` : `${u.nome} reativado.`)}>
                        {u.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    )}
                    </div>
                  </td>
                </tr>
              ))}
              {!lista && <tr><td colSpan={6} className="vazio-td"><Vazio compacto icone="usuarios" titulo="Carregando usuários…" /></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {senhaDe && <NovaSenha u={senhaDe} onClose={() => setSenhaDe(null)} onSalvar={(s) => editar(senhaDe, { senha: s }, `Senha de ${senhaDe.nome} alterada.`).then(() => setSenhaDe(null))} />}
    </main>
  );
}

function NovaSenha({ u, onClose, onSalvar }: { u: Usuario; onClose: () => void; onSalvar: (s: string) => void }) {
  const [s, setS] = useState('');
  return (
    <Modal onClose={onClose} label="Nova senha">
      <div className="modal-topo">
        <div><h2>Nova senha para {u.nome}</h2></div>
        <button className="btn ghost icon" onClick={onClose} aria-label="Fechar"><Icon n="x" /></button>
      </div>
      <input id="nova-senha-adm" className="input" value={s} onChange={(e) => setS(e.target.value)} minLength={8} placeholder="mínimo 8 caracteres" autoFocus />
      <div className="modal-acts">
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn pri" disabled={s.length < 8} onClick={() => onSalvar(s)}>Salvar senha</button>
      </div>
    </Modal>
  );
}

export function TrocarSenha({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [erro, setErro] = useState('');
  async function salvar() {
    setErro('');
    try {
      await api.trocarSenha(atual, nova);
      toast({ texto: 'Senha alterada.', tipo: 'ok' });
      onClose();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Erro ao trocar a senha.');
    }
  }
  return (
    <Modal onClose={onClose} label="Trocar senha">
      <div className="modal-topo">
        <div><h2>Trocar minha senha</h2></div>
        <button className="btn ghost icon" onClick={onClose} aria-label="Fechar"><Icon n="x" /></button>
      </div>
      <input id="senha-atual" className="input" type="password" placeholder="Senha atual" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" />
      <input id="senha-nova" className="input" type="password" placeholder="Nova senha (mínimo 8)" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" />
      {erro && <div className="aviso crit"><Icon n="alert" s={14} /> <span>{erro}</span></div>}
      <div className="modal-acts">
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn pri" disabled={!atual || nova.length < 8} onClick={salvar}>Salvar</button>
      </div>
    </Modal>
  );
}
