/**
 * @fileoverview Guarda de rota: apenas utilizadores com `user_type` cliente acedem às rotas filhas.
 */

import { Navigate, Outlet } from 'react-router-dom'
import { isClienteLogado } from '../lib/sessao'

/**
 * Redireciona colaboradores e visitantes sem sessão de cliente para `/produtos`.
 * @returns `<Outlet />` ou `<Navigate />`.
 */
export function RequireCliente() {
  if (!isClienteLogado()) {
    return <Navigate to="/produtos" replace />
  }
  return <Outlet />
}
