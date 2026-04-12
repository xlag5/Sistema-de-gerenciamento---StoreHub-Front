/**
 * @fileoverview Definição de rotas: `/login` e `/` fora do layout; páginas da aplicação dentro de `AppLayout`.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layout/AppLayout'
import { RequireCliente } from './layout/RequireCliente'
import { RequireColaborador } from './layout/RequireColaborador'
import { CaixaPage } from './pages/Caixa/CaixaPage'
import { DashboardPage } from './pages/Dashboard/DashboardPage'
import { LoginPage } from './pages/Login/LoginPage'
import { MinhasComprasPage } from './pages/MinhasCompras/MinhasComprasPage'
import { ProdutosPage } from './pages/Produtos/ProdutosPage'
import { UsuariosPage } from './pages/Usuarios/UsuariosPage'

/**
 * Componente raiz com `BrowserRouter` e `Routes`.
 * @returns Árvore de rotas da aplicação.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AppLayout />}>
          <Route path="/produtos" element={<ProdutosPage />} />
          <Route element={<RequireCliente />}>
            <Route path="/compras" element={<MinhasComprasPage />} />
          </Route>
          <Route element={<RequireColaborador />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/caixa" element={<CaixaPage />} />
            <Route path="/usuarios" element={<UsuariosPage />} />
          </Route>
        </Route>
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
