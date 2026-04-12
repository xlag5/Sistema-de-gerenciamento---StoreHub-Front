/**
 * @fileoverview Layout autenticável: sidebar + área principal (`Outlet`).
 */

import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { AppSidebar } from './AppSidebar'
import './AppLayout.css'

/**
 * Aplica `app-shell-route` no `documentElement` para estilos globais do contentor.
 * @returns Layout com sidebar e filhos da rota atual.
 */
export function AppLayout() {
  useEffect(() => {
    document.documentElement.classList.add('app-shell-route')
    return () => document.documentElement.classList.remove('app-shell-route')
  }, [])

  return (
    <div className="app-shell">
      <AppSidebar />
      <div className="app-shell-main" id="conteudo-principal">
        <Outlet />
      </div>
    </div>
  )
}
