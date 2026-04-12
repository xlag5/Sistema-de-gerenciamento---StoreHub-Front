/**
 * @fileoverview Utilizadores: cadastro (`POST /users`), edição (`PUT /users/:id`), listagem (`GET /users`), filtros e máscara de telefone BR.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { API_BASE } from '../../lib/apiBase'
import './UsuariosPage.css'

/** Tipo escolhido no formulário (mapeado para `user_type` na API). */
type TipoUsuario = 'colaborador' | 'cliente'

/** Valores da coluna `users.user_type` no backend. */
type AppUserType = 'cliente' | 'adm' | 'funcionario'

/** Item normalizado para a tabela e badges na UI. */
type UsuarioListaItem = {
  id: string
  nome: string
  /** Texto mostrado na lista (pode ser placeholder se não houver e-mail). */
  email: string
  /** E-mail normalizado para o formulário de edição (pode ser vazio). */
  emailApi: string
  tipo: TipoUsuario
  userId?: number
  userType?: AppUserType
  telefone?: string
  ativo: number
}

/** Linha de `GET /users` (`SELECT * FROM users`): campos podem vir nulos ou legados. */
type ApiUserRow = {
  user_id: number
  email?: string | null
  password_hash?: string
  user_type?: string | null
  nome?: string | null
  telefone?: string | null
  ativo?: number
  created_at?: string
}

/** Filtro pela propriedade normalizada `userType` (origem: `user_type` no backend). */
type FiltroLista = 'todos' | AppUserType

/** Corpo JSON de erro da API. */
type ApiErrorBody = { error?: string }

/**
 * Remove tudo que não for dígito (útil para telefone e validações).
 * @param s Texto bruto ou nulo.
 */
function digitosSoNumeros(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

/**
 * Alinha `user_type` do banco (ex.: `admin`, `employee`) ao modelo da UI.
 * @param raw Valor cru da coluna ou `undefined`.
 * @returns Tipo normalizado ou `undefined` se não reconhecido.
 */
function normalizarUserTypeApi(raw: string | null | undefined): AppUserType | undefined {
  const t = (raw ?? '').toLowerCase().trim()
  if (t === 'cliente') return 'cliente'
  if (t === 'adm' || t === 'admin') return 'adm'
  if (t === 'funcionario' || t === 'employee') return 'funcionario'
  return undefined
}

/**
 * Converte uma linha desconhecida de `GET /users` num item de lista ou `null` se inválida.
 * @param row Elemento do array JSON.
 */
function mapearLinhaUsersGet(row: unknown): UsuarioListaItem | null {
  if (typeof row !== 'object' || row === null) return null
  const u = row as ApiUserRow
  const idNum = Number(u.user_id)
  if (!Number.isFinite(idNum)) return null
  const emailNorm = (u.email ?? '').trim().toLowerCase()
  const nomeStr =
    typeof u.nome === 'string' ? u.nome : String(u.nome ?? '')
  const userTypeNorm = normalizarUserTypeApi(u.user_type ?? undefined)
  const telDigitos = digitosSoNumeros(u.telefone)
  const ativo =
    typeof u.ativo === 'number' && (u.ativo === 0 || u.ativo === 1) ? u.ativo : 1
  return {
    id: `user_${idNum}`,
    nome: nomeStr.trim() || '(sem nome)',
    email: emailNorm || '(sem e-mail)',
    emailApi: emailNorm,
    tipo: userTypeNorm === 'cliente' ? 'cliente' : 'colaborador',
    userId: idNum,
    userType: userTypeNorm,
    telefone: telDigitos.length > 0 ? telDigitos : undefined,
    ativo,
  }
}

/**
 * Máscara brasileira: (XX) XXXXX-XXXX (celular, 11 dígitos) ou (XX) XXXX-XXXX (fixo, 10).
 * Durante a digitação, se o 9º dígito (após DDD) for 9, assume padrão de celular.
 */
function aplicarMascaraTelefoneBr(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  const ddd = d.slice(0, 2)
  const r = d.slice(2)
  if (d.length <= 6) {
    return `(${ddd}) ${r}`
  }
  const nove = r[0] === '9'
  if (d.length === 11) {
    return `(${ddd}) ${r.slice(0, 5)}-${r.slice(5)}`
  }
  if (d.length === 10) {
    return `(${ddd}) ${r.slice(0, 4)}-${r.slice(4)}`
  }
  if (nove) {
    if (r.length <= 5) return `(${ddd}) ${r}`
    return `(${ddd}) ${r.slice(0, 5)}-${r.slice(5)}`
  }
  if (r.length <= 4) return `(${ddd}) ${r}`
  return `(${ddd}) ${r.slice(0, 4)}-${r.slice(4)}`
}

/** Rótulo textual do badge conforme `userType` / `tipo`. */
function rotuloBadgeUsuario(u: UsuarioListaItem): string {
  if (u.userType === 'cliente' || (u.tipo === 'cliente' && !u.userType)) {
    return 'Cliente'
  }
  if (u.userType === 'adm') return 'Administrador'
  if (u.userType === 'funcionario') return 'Funcionário'
  return 'Colaborador'
}

/** Classes CSS do badge de tipo de utilizador. */
function classeBadgeUsuario(u: UsuarioListaItem): string {
  if (u.userType === 'cliente' || (u.tipo === 'cliente' && !u.userType)) {
    return 'badge cliente'
  }
  if (u.userType === 'adm') return 'badge admin'
  return 'badge'
}

/** Valida comprimento de telefone BR (10 ou 11 dígitos). */
function validarTelefoneDigitos(tel: string): boolean {
  return tel.length >= 10 && tel.length <= 11
}

/** Aplica máscara BR aos dígitos só para exibição. */
function formatarTelefoneExibicao(digitos: string): string {
  return aplicarMascaraTelefoneBr(digitos)
}

/**
 * Lê mensagem de erro de uma resposta HTTP da API de utilizadores.
 * @param res Resposta `fetch`.
 */
async function lerErroApi(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ApiErrorBody
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error.trim()
    }
  } catch {
    /* ignore */
  }
  return 'Erro ao comunicar com o servidor.'
}

/**
 * Página de utilizadores: formulário de cadastro, lista filtrável e estado de ligação ao backend.
 * @returns UI de gestão de utilizadores.
 */
export function UsuariosPage() {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [telefone, setTelefone] = useState('')
  const [tipo, setTipo] = useState<TipoUsuario>('colaborador')
  const [senha, setSenha] = useState('')
  const [formErrors, setFormErrors] = useState<{
    nome?: string
    email?: string
    telefone?: string
    senha?: string
    api?: string
  }>({})
  const [lista, setLista] = useState<UsuarioListaItem[]>([])
  const [filtro, setFiltro] = useState<FiltroLista>('todos')
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [cadastrando, setCadastrando] = useState(false)
  /** `null` = modo cadastro; caso contrário `PUT /users/:id`. */
  const [editingUserId, setEditingUserId] = useState<number | null>(null)
  /** Em edição de colaborador: `adm` ou `funcionario` na API. */
  const [perfilColaboradorEdicao, setPerfilColaboradorEdicao] = useState<
    'adm' | 'funcionario' | null
  >(null)
  const [ativoUsuario, setAtivoUsuario] = useState(1)

  const validarEmail = (valor: string) => /\S+@\S+\.\S+/.test(valor)

  const resetFormulario = useCallback(() => {
    setEditingUserId(null)
    setPerfilColaboradorEdicao(null)
    setNome('')
    setEmail('')
    setTelefone('')
    setTipo('colaborador')
    setSenha('')
    setAtivoUsuario(1)
    setFormErrors({})
  }, [])

  const iniciarEdicao = (u: UsuarioListaItem) => {
    if (u.userId == null) return
    setEditingUserId(u.userId)
    setNome(u.nome === '(sem nome)' ? '' : u.nome)
    setEmail(u.emailApi)
    setTelefone(u.telefone ? formatarTelefoneExibicao(u.telefone) : '')
    if (u.userType === 'cliente' || u.tipo === 'cliente') {
      setTipo('cliente')
      setPerfilColaboradorEdicao(null)
    } else {
      setTipo('colaborador')
      setPerfilColaboradorEdicao(u.userType === 'adm' ? 'adm' : 'funcionario')
    }
    setSenha('')
    setAtivoUsuario(u.ativo === 0 ? 0 : 1)
    setFormErrors({})
  }

  /** Recarrega a lista a partir de `GET /users`. */
  const recarregarLista = useCallback(async () => {
    try {
      const usersRes = await fetch(`${API_BASE}/users`)
      if (!usersRes.ok) {
        setLista([])
        setBackendOk(false)
        return
      }
      const payload = (await usersRes.json()) as unknown
      const rows = Array.isArray(payload) ? payload : []
      const apiItems = rows
        .map(mapearLinhaUsersGet)
        .filter((item): item is UsuarioListaItem => item !== null)
      setLista(apiItems)
      setBackendOk(true)
    } catch {
      setLista([])
      setBackendOk(false)
    }
  }, [])

  useEffect(() => {
    let cancelado = false
    fetch(`${API_BASE}/health`)
      .then((res) => {
        if (!cancelado) setBackendOk(res.ok)
      })
      .catch(() => {
        if (!cancelado) setBackendOk(false)
      })
    return () => {
      cancelado = true
    }
  }, [])

  useEffect(() => {
    void recarregarLista()
  }, [recarregarLista])

  useEffect(() => {
    document.documentElement.classList.add('usuarios-route')
    return () => document.documentElement.classList.remove('usuarios-route')
  }, [])

  const listaFiltrada = useMemo(() => {
    if (filtro === 'todos') return lista
    return lista.filter((u) => u.userType === filtro)
  }, [lista, filtro])

  /** Valida e envia `POST /users` ou `PUT /users/:id`. */
  const handleSubmitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const isEdit = editingUserId !== null

    /**
     * `backendOk` começa em `null` até o /health do useEffect responder.
     * Se o utilizador clicar em Cadastrar antes disso, o código antigo caía
     * no fluxo offline e nunca fazia POST. Aqui confirmamos o servidor no submit.
     */
    let servidorDisponivel: boolean
    if (backendOk === true) {
      servidorDisponivel = true
    } else {
      try {
        const h = await fetch(`${API_BASE}/health`)
        servidorDisponivel = h.ok
      } catch {
        servidorDisponivel = false
      }
      if (servidorDisponivel !== backendOk) {
        setBackendOk(servidorDisponivel)
      }
    }

    const erros: {
      nome?: string
      email?: string
      telefone?: string
      senha?: string
      api?: string
    } = {}

    if (!nome.trim()) {
      erros.nome = 'Informe o nome.'
    }
    if (!email.trim()) {
      erros.email = 'Informe o e-mail.'
    } else if (!validarEmail(email)) {
      erros.email = 'E-mail inválido.'
    }

    const telDigitos = digitosSoNumeros(telefone)

    if (!telDigitos) {
      erros.telefone = 'Informe o telefone.'
    } else if (!validarTelefoneDigitos(telDigitos)) {
      erros.telefone = 'Telefone inválido (10 ou 11 dígitos).'
    }
    if (!isEdit && !senha.trim()) {
      erros.senha = 'Informe a senha.'
    } else if (senha.trim() && senha.length < 6) {
      erros.senha = 'Mínimo 6 caracteres.'
    }

    if (!servidorDisponivel) {
      erros.api = isEdit
        ? 'Sem conexão com o servidor. A edição só é possível com a API ativa.'
        : 'Sem conexão com o servidor. Cadastro só é possível com a API ativa.'
    }

    setFormErrors(erros)
    if (Object.keys(erros).length > 0) return

    const emailNorm = email.trim().toLowerCase()

    const user_type: AppUserType =
      tipo === 'cliente'
        ? 'cliente'
        : isEdit && perfilColaboradorEdicao === 'adm'
          ? 'adm'
          : 'funcionario'

    try {
      setCadastrando(true)
      setFormErrors((prev) => ({ ...prev, api: undefined }))
      if (isEdit && editingUserId !== null) {
        const payload: Record<string, unknown> = {
          email: emailNorm,
          user_type,
          nome: nome.trim(),
          telefone: telDigitos,
          ativo: ativoUsuario === 0 ? 0 : 1,
        }
        if (senha.trim()) payload.password_hash = senha.trim()
        const res = await fetch(`${API_BASE}/users/${editingUserId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          setFormErrors({ api: await lerErroApi(res) })
          return
        }
        await recarregarLista()
        resetFormulario()
        return
      }

      const res = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailNorm,
          password_hash: senha,
          user_type,
          nome: nome.trim(),
          telefone: telDigitos,
          ativo: 1,
        }),
      })
      if (!res.ok) {
        setFormErrors({ api: await lerErroApi(res) })
        return
      }
      await recarregarLista()
      resetFormulario()
    } catch {
      setFormErrors({
        api: 'Não foi possível conectar ao servidor. Tente novamente.',
      })
      setBackendOk(false)
      await recarregarLista()
    } finally {
      setCadastrando(false)
    }
  }

  const statusMensagem =
    backendOk === false
      ? 'Sem conexão com o servidor: verifique se a API está em execução.'
      : null

  return (
    <div className="usuarios-page">
      <header className="usuarios-header">
        <div>
          <h1 className="usuarios-titulo">Usuários</h1>
          <p className="usuarios-subtitulo">
            Cadastre ou edite colaboradores e clientes
          </p>
        </div>
      </header>

      <div className="usuarios-grid">
        <section className="card" aria-labelledby="novo-usuario-titulo">
          <h2 id="novo-usuario-titulo" className="card-titulo">
            {editingUserId !== null ? 'Editar usuário' : 'Novo usuário'}
          </h2>
          <form className="usuarios-form" onSubmit={handleSubmitForm} noValidate>
            {formErrors.api ? (
              <p className="erro-campo erro-api" role="alert">
                {formErrors.api}
              </p>
            ) : null}
            <div className="campo">
              <label htmlFor="cad-nome">Nome</label>
              <input
                id="cad-nome"
                type="text"
                placeholder="Ex: Maria Silva"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                aria-invalid={Boolean(formErrors.nome)}
              />
              {formErrors.nome ? (
                <span className="erro-campo">{formErrors.nome}</span>
              ) : null}
            </div>
            <div className="campo">
              <label htmlFor="cad-email">E-mail</label>
              <input
                id="cad-email"
                type="email"
                placeholder="maria@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(formErrors.email)}
              />
              {formErrors.email ? (
                <span className="erro-campo">{formErrors.email}</span>
              ) : null}
            </div>

            <div className="campo">
              <label htmlFor="cad-telefone">Telefone</label>
              <input
                id="cad-telefone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(11) 98765-4321"
                maxLength={16}
                value={telefone}
                onChange={(e) =>
                  setTelefone(aplicarMascaraTelefoneBr(e.target.value))
                }
                aria-invalid={Boolean(formErrors.telefone)}
              />
              {formErrors.telefone ? (
                <span className="erro-campo">{formErrors.telefone}</span>
              ) : null}
            </div>
            
            <div className="campo">
              <label htmlFor="cad-tipo">Tipo</label>
              <select
                id="cad-tipo"
                value={tipo}
                onChange={(e) => {
                  const v = e.target.value as TipoUsuario
                  setTipo(v)
                  if (v === 'cliente') {
                    setPerfilColaboradorEdicao(null)
                  } else if (perfilColaboradorEdicao === null) {
                    setPerfilColaboradorEdicao('funcionario')
                  }
                }}
              >
                <option value="colaborador">Colaborador</option>
                <option value="cliente">Cliente</option>
              </select>
            </div>
            {editingUserId !== null && tipo === 'colaborador' ? (
              <div className="campo">
                <label htmlFor="cad-perfil-colab">Perfil do colaborador</label>
                <select
                  id="cad-perfil-colab"
                  value={perfilColaboradorEdicao ?? 'funcionario'}
                  onChange={(e) =>
                    setPerfilColaboradorEdicao(
                      e.target.value as 'adm' | 'funcionario',
                    )
                  }
                >
                  <option value="funcionario">Funcionário</option>
                  <option value="adm">Administrador</option>
                </select>
              </div>
            ) : null}
            {editingUserId !== null ? (
              <div className="campo">
                <label htmlFor="cad-ativo">Conta ativa</label>
                <select
                  id="cad-ativo"
                  value={ativoUsuario === 0 ? '0' : '1'}
                  onChange={(e) =>
                    setAtivoUsuario(e.target.value === '0' ? 0 : 1)
                  }
                >
                  <option value="1">Sim</option>
                  <option value="0">Não</option>
                </select>
              </div>
            ) : null}
            <div className="campo">
              <label htmlFor="cad-senha">Senha</label>
              <input
                id="cad-senha"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                aria-invalid={Boolean(formErrors.senha)}
                autoComplete="new-password"
              />
              <p className="hint">
                {editingUserId !== null
                  ? 'Deixe em branco para manter a senha atual. Se alterar, mínimo 6 caracteres.'
                  : 'Obrigatória no cadastro (mínimo 6 caracteres).'}
              </p>
              {formErrors.senha ? (
                <span className="erro-campo">{formErrors.senha}</span>
              ) : null}
            </div>
            <div className="usuarios-form-botoes">
              {editingUserId !== null ? (
                <button
                  type="button"
                  className="btn-ghost btn-ghost--full"
                  disabled={cadastrando}
                  onClick={() => resetFormulario()}
                >
                  Cancelar edição
                </button>
              ) : null}
              <button type="submit" className="btn-primary" disabled={cadastrando}>
                {cadastrando
                  ? editingUserId !== null
                    ? 'A guardar...'
                    : 'A cadastrar...'
                  : editingUserId !== null
                    ? 'Salvar alterações'
                    : 'Cadastrar'}
              </button>
            </div>
            {statusMensagem ? (
              <p className="status-local">{statusMensagem}</p>
            ) : null}
          </form>
        </section>

        <section aria-labelledby="lista-titulo">
          <div className="lista-header">
            <h2 id="lista-titulo">Lista de usuários</h2>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void recarregarLista()}
            >
              Atualizar lista
            </button>
          </div>

          <div className="filtros" role="tablist" aria-label="Filtrar lista">
            <button
              type="button"
              role="tab"
              aria-selected={filtro === 'todos'}
              className={`filtro${filtro === 'todos' ? ' ativo' : ''}`}
              onClick={() => setFiltro('todos')}
            >
              Todos
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filtro === 'cliente'}
              className={`filtro${filtro === 'cliente' ? ' ativo' : ''}`}
              onClick={() => setFiltro('cliente')}
            >
              Cliente
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filtro === 'adm'}
              className={`filtro${filtro === 'adm' ? ' ativo' : ''}`}
              onClick={() => setFiltro('adm')}
            >
              Administrador
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filtro === 'funcionario'}
              className={`filtro${filtro === 'funcionario' ? ' ativo' : ''}`}
              onClick={() => setFiltro('funcionario')}
            >
              Funcionário
            </button>
          </div>

          <div className="card lista-card">
            {listaFiltrada.length === 0 ? (
              <div className="lista-vazia">
                Nenhum usuário cadastrado ainda.
              </div>
            ) : (
              <ul className="lista-itens">
                {listaFiltrada.map((u) => (
                  <li key={u.id}>
                    <div className="lista-item-linha">
                      <div className="lista-item-corpo">
                        <div className="item-nome">
                          {u.nome}
                          <span className={classeBadgeUsuario(u)}>
                            {rotuloBadgeUsuario(u)}
                          </span>
                          {u.ativo === 0 ? (
                            <span className="badge badge-inativo">Inativo</span>
                          ) : null}
                        </div>
                        <div className="item-meta">{u.email}</div>
                        {u.telefone ? (
                          <div className="item-doc">
                            <span>
                              Tel.: {formatarTelefoneExibicao(u.telefone)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn-editar-usuario"
                        onClick={() => iniciarEdicao(u)}
                      >
                        Editar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
