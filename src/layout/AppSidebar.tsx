/**
 * @fileoverview Barra lateral global: navegação principal, recolhimento persistido e sessão do utilizador.
 */

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { isClienteLogado } from '../lib/sessao'
import './AppSidebar.css'

/** Dados mínimos do utilizador em sessão (localStorage `usuarioLogado`). */
type Sessao = { nome: string; email: string }

/**
 * Lê e normaliza o JSON de `usuarioLogado` no `localStorage`.
 * @returns Objeto com nome e e-mail ou `null` se inexistente ou inválido.
 */
function lerSessao(): Sessao | null {
  try {
    const raw = localStorage.getItem('usuarioLogado')
    if (!raw) return null
    const j = JSON.parse(raw) as { nome?: string; email?: string }
    return {
      nome: (j.nome ?? '').trim() || 'Utilizador',
      email: (j.email ?? '').trim() || '—',
    }
  } catch {
    return null
  }
}

/** Ícones SVG inline (24×24) para os itens de menu. */

function IconePainel() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function IconeCaixa() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M3 10h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M3 10V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2M12 5V3M8 5h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconeCompras() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconeEstoque() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M3.27 6.96 12 12.01l8.73-5.05" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function IconeUsuarios() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconeSair() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconeMenu() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

type VisivelNav = 'todos' | 'cliente' | 'colaborador'

type ItemNav = {
  to: string
  label: string
  Icon: () => JSX.Element
  /** Quem vê o item: todos, só cliente ou só colaborador (não cliente). */
  visivelPara: VisivelNav
}

/** Rotas e rótulos da navegação principal (ordem de exibição). */
const NAV: ItemNav[] = [
  { to: '/usuarios', label: 'Usuários', Icon: IconeUsuarios, visivelPara: 'colaborador' },
  { to: '/produtos', label: 'Estoque', Icon: IconeEstoque, visivelPara: 'todos' },
  { to: '/compras', label: 'Minhas compras', Icon: IconeCompras, visivelPara: 'cliente' },
  { to: '/caixa', label: 'Caixa', Icon: IconeCaixa, visivelPara: 'colaborador' },
  { to: '/dashboard', label: 'Dashboard', Icon: IconePainel, visivelPara: 'colaborador' },
]

/**
 * Sidebar com `NavLink` ativos, botão sair (limpa sessão) e estado recolhido (`app_sidebar_recolhido`).
 * @returns Elemento `<aside>` da navegação lateral.
 */
export function AppSidebar() {
  const navigate = useNavigate()
  const sessao = useMemo(() => lerSessao(), [])

  const itensNav = useMemo(() => {
    const cli = isClienteLogado()
    return NAV.filter((i) => {
      if (i.visivelPara === 'todos') return true
      if (i.visivelPara === 'cliente') return cli
      return !cli
    })
  }, [])

  const [recolhido, setRecolhido] = useState(() => {
    try {
      return localStorage.getItem('app_sidebar_recolhido') === '1'
    } catch {
      return false
    }
  })

  /** Alterna largura expandida/recolhida e persiste em `localStorage`. */
  const alternarRecolher = () => {
    setRecolhido((v) => {
      const n = !v
      try {
        localStorage.setItem('app_sidebar_recolhido', n ? '1' : '0')
      } catch {
        /* ignore */
      }
      return n
    })
  }

  /** Remove `usuarioLogado` e navega para `/login`. */
  const sair = () => {
    try {
      localStorage.removeItem('usuarioLogado')
    } catch {
      /* ignore */
    }
    navigate('/login', { replace: true })
  }

  /**
   * Gera iniciais para o avatar (até duas letras).
   * @param nome Nome completo ou apelido.
   */
  const iniciais = (nome: string) => {
    const p = nome.trim().split(/\s+/).filter(Boolean)
    if (p.length === 0) return '?'
    if (p.length === 1) return p[0].slice(0, 2).toUpperCase()
    return (p[0][0] + p[p.length - 1][0]).toUpperCase()
  }

  return (
    <aside
      className={`app-sidebar${recolhido ? ' app-sidebar--recolhido' : ''}`}
      aria-label="Menu principal"
    >
      <div className="app-sidebar-top">
        <div className="app-sidebar-brand">
          <span className="app-sidebar-brand-mark" aria-hidden>
            <img
              src="/iconeterere.png"
              alt=""
              width={28}
              height={28}
              className="app-sidebar-brand-img"
            />
          </span>
          {!recolhido ? (
            <span className="app-sidebar-brand-text">
              {isClienteLogado() ? 'StoreHub' : 'Gestão'}
            </span>
          ) : null}
          <button
            type="button"
            className="app-sidebar-toggle"
            onClick={alternarRecolher}
            aria-expanded={!recolhido}
            aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'}
          >
            <IconeMenu />
          </button>
        </div>
      </div>

      <nav className="app-sidebar-nav" aria-label="Secções">
        {itensNav.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `app-sidebar-link${isActive ? ' app-sidebar-link--active' : ''}`
            }
            end={to === '/dashboard'}
          >
            <span className="app-sidebar-link-ico">
              <Icon />
            </span>
            <span className="app-sidebar-link-text">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="app-sidebar-bottom">
        <button type="button" className="app-sidebar-link app-sidebar-link--ghost" onClick={sair}>
          <span className="app-sidebar-link-ico">
            <IconeSair />
          </span>
          <span className="app-sidebar-link-text">Sair</span>
        </button>

        <div className="app-sidebar-perfil" title={sessao?.email ?? ''}>
          <div className="app-sidebar-avatar" aria-hidden>
            {sessao ? iniciais(sessao.nome) : '?'}
            {sessao ? <span className="app-sidebar-avatar-dot" /> : null}
          </div>
          {!recolhido ? (
            <div className="app-sidebar-perfil-textos">
              <span className="app-sidebar-perfil-nome">
                {sessao?.nome ?? 'Sem sessão'}
              </span>
              <span className="app-sidebar-perfil-email">
                {sessao?.email ?? 'Inicie sessão no login'}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
