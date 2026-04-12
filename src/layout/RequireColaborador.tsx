/**
 * @fileoverview Guarda de rota: utilizadores com `user_type` cliente são redirecionados para o catálogo.
 */

import { Navigate, Outlet } from 'react-router-dom'
import { isClienteLogado } from '../lib/sessao'

/**
 * Só renderiza as rotas filhas se o utilizador não for cliente; caso contrário redireciona para `/produtos`.
 * @returns `<Outlet />` ou `<Navigate />`.
 */
export function RequireColaborador() {
  if (isClienteLogado()) {
    return <Navigate to="/produtos" replace />
  }
  return <Outlet />
}
