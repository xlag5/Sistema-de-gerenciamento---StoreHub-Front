/**
 * @fileoverview Página de autenticação: formulário e `POST /users/login` com credenciais no corpo JSON.
 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../../lib/apiBase'
import './LoginPage.css'

/**
 * Utilizador público devolvido por `POST /users/login` em caso de sucesso (sem `password_hash`).
 */
type PublicUser = {
  user_id: number
  email: string
  user_type: string
  nome: string
  telefone: string
  ativo: number
  created_at: string
  access_token?: string
  bearer_token?: string
}

/** Corpo JSON de erro genérico devolvido pela API. */
type ApiErrorBody = {
  error?: string
}

/** Ícone de “mostrar senha” (olho aberto). */
function IconeOlhoAberto() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/** Ícone de “ocultar senha” (olho riscado). */
function IconeOlhoFechado() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  )
}

/**
 * Extrai mensagem amigável de uma resposta HTTP de login falhado.
 * @param response Resposta `fetch` não OK.
 * @returns Texto para exibir ao utilizador.
 */
async function mensagemErroDaResposta(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error.trim()
    }
  } catch {
    // corpo não JSON ou vazio
  }
  if (response.status === 401) {
    return 'Credenciais invalidas ou usuario inativo.'
  }
  if (response.status === 400) {
    return 'Requisicao invalida.'
  }
  return 'Erro ao autenticar.'
}

/**
 * Formulário de login: validação local, persistência de `usuarioLogado` e redirecionamento pós-sucesso.
 * @returns Página de acesso à conta.
 */
export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [errors, setErrors] = useState<{ email?: string; senha?: string }>({})
  const [mensagemSucesso, setMensagemSucesso] = useState('')
  const [mensagemErroApi, setMensagemErroApi] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [senhaVisivel, setSenhaVisivel] = useState(false)

  /** Validação simples de formato de e-mail. */
  const validarEmail = (valor: string) => /\S+@\S+\.\S+/.test(valor)

  /** Submete credenciais à API e, em caso de sucesso, grava sessão e navega. */
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const novosErros: { email?: string; senha?: string } = {}

    if (!email.trim()) {
      novosErros.email = 'O e-mail e obrigatorio.'
    } else if (!validarEmail(email)) {
      novosErros.email = 'Digite um e-mail valido.'
    }

    if (!senha.trim()) {
      novosErros.senha = 'A senha e obrigatoria.'
    } else if (senha.length < 6) {
      novosErros.senha = 'A senha deve ter no minimo 6 caracteres.'
    }

    setErrors(novosErros)
    setMensagemErroApi('')

    if (Object.keys(novosErros).length === 0) {
      try {
        setCarregando(true)

        const response = await fetch(`${API_BASE}/users/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            password_hash: senha,
          }),
        })

        if (!response.ok) {
          setMensagemSucesso('')
          setMensagemErroApi(await mensagemErroDaResposta(response))
          return
        }

        const usuario = (await response.json()) as PublicUser
        const access_token =
          typeof usuario.access_token === 'string' ? usuario.access_token.trim() : ''
        const bearer_token =
          typeof usuario.bearer_token === 'string' ? usuario.bearer_token.trim() : ''

        setMensagemSucesso('Login realizado com sucesso.')
        localStorage.setItem(
          'usuarioLogado',
          JSON.stringify({
            user_id: usuario.user_id,
            email: usuario.email,
            user_type: usuario.user_type,
            nome: usuario.nome,
            telefone: usuario.telefone,
            ativo: usuario.ativo,
            created_at: usuario.created_at,
            ...(access_token ? { access_token } : {}),
            ...(bearer_token ? { bearer_token } : {}),
          }),
        )
        const destino =
          (usuario.user_type ?? '').toLowerCase().trim() === 'cliente'
            ? '/produtos'
            : '/usuarios'
        navigate(destino, { replace: true })
      } catch {
        setMensagemSucesso('')
        setMensagemErroApi(
          'Nao foi possivel conectar ao backend. Verifique se a API esta ativa em http://localhost:3000.',
        )
      } finally {
        setCarregando(false)
      }
      return
    }

    setMensagemSucesso('')
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="titulo-login">
        <h1 id="titulo-login">Acessar conta</h1>
        <p className="subtitle">Entre com seu e-mail e senha para continuar.</p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              placeholder="nome@exemplo.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
            />
            {errors.email ? (
              <small className="error" id="email-error">
                {errors.email}
              </small>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="senha">Senha</label>
            <div className="password-row">
              <input
                id="senha"
                type={senhaVisivel ? 'text' : 'password'}
                placeholder="Digite sua senha"
                value={senha}
                onChange={(event) => setSenha(event.target.value)}
                aria-invalid={Boolean(errors.senha)}
                aria-describedby={errors.senha ? 'senha-error' : undefined}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="toggle-password"
                onClick={() => setSenhaVisivel((visivel) => !visivel)}
                aria-pressed={senhaVisivel}
                aria-label={senhaVisivel ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {senhaVisivel ? <IconeOlhoFechado /> : <IconeOlhoAberto />}
              </button>
            </div>
            {errors.senha ? (
              <small className="error" id="senha-error">
                {errors.senha}
              </small>
            ) : null}
          </div>

          <button type="submit" disabled={carregando}>
            {carregando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        {mensagemSucesso ? <p className="success">{mensagemSucesso}</p> : null}
        {mensagemErroApi ? <p className="error api-error">{mensagemErroApi}</p> : null}
      </section>
    </main>
  )
}
