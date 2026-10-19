import { useEffect, useState } from 'react';
import { api, ErroApi } from './api';
import type { Usuario } from '../shared/types';
import { situacaoTurno } from '../shared/calendar';
import { dataCurta, diaSemanaLongo, hora } from '../shared/fmt';

export function Login({ onEntrar }: { onEntrar: (u: Usuario) => void }) {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [ver, setVer] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    const h = setInterval(() => setAgora(new Date()), 15_000);
    return () => clearInterval(h);
  }, []);

  async function entrar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro('');
    if (!usuario.trim() || !senha) {
      setErro('Informe o usuário e a senha.');
      return;
    }
    setEnviando(true);
    try {
      const r = await api.entrar(usuario, senha);
      onEntrar(r.usuario);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível entrar.');
      setEnviando(false);
    }
  }

  const turno = situacaoTurno(agora, []);

  return (
    <div className="lg">
      <div className="lg-feixe" aria-hidden="true">
        <i />
        <i />
      </div>
      <img className="lg-farol" src="/farol.png" alt="" aria-hidden="true" />

      <main className="lg-lado">
        <img className="lg-logo" src="/logo-h-white.png" alt="Duramax Tintas e Vernizes" />

        <form className="lg-form" onSubmit={entrar} noValidate>
          <div className="lg-titulo">
            <span>Sistema de produção</span>
            <h1>Entrar</h1>
          </div>

          <label className="lg-campo">
            <span>Usuário</span>
            <input
              id="login-usuario"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="ex.: samuel"
              required
              autoFocus
            />
          </label>

          <label className="lg-campo">
            <span>Senha</span>
            <div className="lg-senha">
              <input
                id="login-senha"
                type={ver ? 'text' : 'password'}
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
              <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Esconder senha' : 'Mostrar senha'}>
                {ver ? 'ocultar' : 'mostrar'}
              </button>
            </div>
          </label>

          {erro && <div className="lg-erro" role="alert">{erro}</div>}

          <button className="lg-entrar" type="submit" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <footer className="lg-rodape">
          <span className={`lg-turno ${turno}`}>
            <i />
            {turno === 'producao' ? 'Produção em expediente' : turno === 'almoco' ? 'Almoço até 13:12' : 'Fora do expediente'}
          </span>
          <span className="num">
            {diaSemanaLongo(agora)}, {dataCurta(agora)} · {hora(agora)}
          </span>
        </footer>
      </main>
    </div>
  );
}
