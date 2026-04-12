/**
 * @fileoverview Leitura da sessão em `localStorage` (`usuarioLogado`) para regras de UI e rotas.
 */

/**
 * Indica se o utilizador em sessão tem `user_type` de cliente.
 * @returns `true` quando `user_type` (case-insensitive) é `cliente`.
 */
export function isClienteLogado(): boolean {
  try {
    const raw = localStorage.getItem('usuarioLogado')
    if (!raw) return false
    const o = JSON.parse(raw) as { user_type?: string }
    return (o.user_type ?? '').toLowerCase().trim() === 'cliente'
  } catch {
    return false
  }
}

/**
 * `user_id` do utilizador em sessão (`usuarioLogado`).
 * @returns Identificador inteiro positivo ou `null` se não existir sessão válida.
 */
export function obterUserIdLogado(): number | null {
  try {
    const raw = localStorage.getItem('usuarioLogado')
    if (!raw) return null
    const o = JSON.parse(raw) as { user_id?: number }
    const id = o.user_id
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null
    return id
  } catch {
    return null
  }
}

/**
 * JWT da sessão (`usuarioLogado`), conforme devolvido no login.
 * Prioridade: `access_token`, depois `bearer_token`.
 */
function obterJwtSessao(): string | null {
  try {
    const raw = localStorage.getItem('usuarioLogado')
    if (!raw) return null
    const o = JSON.parse(raw) as {
      access_token?: unknown
      bearer_token?: unknown
    }
    const a = o.access_token
    const b = o.bearer_token
    if (typeof a === 'string') {
      const t = a.trim()
      if (t) return t
    }
    if (typeof b === 'string') {
      const t = b.trim()
      if (t) return t
    }
    return null
  } catch {
    return null
  }
}

/**
 * Cabeçalho `Authorization: Bearer <jwt>` para pedidos a `/sales` e `/sale-items`.
 * Objeto vazio se não houver token em sessão.
 */
export function cabecalhosAuthBearer(): Record<string, string> {
  const jwt = obterJwtSessao()
  if (!jwt) return {}
  return { Authorization: `Bearer ${jwt}` }
}
