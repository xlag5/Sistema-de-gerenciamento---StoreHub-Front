/**
 * @fileoverview Histórico de compras do cliente: vendas filtradas por `user_id_cliente` (API v2) ou `user_id` legado.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { cabecalhosAuthBearer, obterUserIdLogado } from '../../lib/sessao'
import './MinhasComprasPage.css'

type Sale = {
  sale_id: number
  seller_id?: number
  user_id_cliente?: number
  /** Legado: antes da coluna `user_id_cliente`. */
  user_id?: number
  total_value?: number
  created_at: string
} & Record<string, unknown>

type SaleItem = {
  sale_item_id: number
  sale_id: number
  product_id: number
  quantity?: number
  unit_price?: number
  subtotal?: number
} & Record<string, unknown>

type Product = {
  product_id: number
  name: string
}

type ApiErrorBody = { error?: string }

function parseNumeroApi(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const t = v.trim().replace(/\s/g, '')
    if (!t) return 0
    const lastComma = t.lastIndexOf(',')
    const lastDot = t.lastIndexOf('.')
    let norm = t
    if (lastComma !== -1 && lastComma > lastDot) {
      norm = t.replace(/\./g, '').replace(',', '.')
    } else if (lastDot !== -1 && lastDot > lastComma) {
      norm = t.replace(/,/g, '')
    } else if (lastComma !== -1) {
      norm = t.replace(',', '.')
    }
    const n = Number.parseFloat(norm)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function totalVendaLinha(s: Sale): number {
  const o = s as Record<string, unknown>
  const raw =
    o.total_value ??
    o.totalValue ??
    o.valor_total ??
    o.valorTotal ??
    o.total
  return parseNumeroApi(raw)
}

function formatBRL(n: number): string {
  const x = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(x)
}

function formatarDataHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d)
}

async function lerErroApi(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ApiErrorBody
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error.trim()
    }
  } catch {
    /* ignore */
  }
  return 'Erro ao carregar dados.'
}

/** Cliente da venda: `user_id_cliente` (backend v2) ou `user_id` (legado). */
function obterClienteUserIdDaVenda(s: Sale): number | null {
  const o = s as Record<string, unknown>
  const raw = o.user_id_cliente ?? o.user_id
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw
  if (typeof raw === 'string') {
    const n = Number.parseInt(raw, 10)
    if (Number.isInteger(n) && n > 0) return n
  }
  return null
}

/**
 * Lista de compras do utilizador cliente (filtradas por `user_id` em sessão).
 * @returns Página de histórico de vendas.
 */
export function MinhasComprasPage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [saleItems, setSaleItems] = useState<SaleItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const userId = useMemo(() => obterUserIdLogado(), [])

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const authSales = cabecalhosAuthBearer()
      const [rS, rI, rP] = await Promise.all([
        fetch(`${API_BASE}/sales`, { headers: { ...authSales } }),
        fetch(`${API_BASE}/sale-items`, { headers: { ...authSales } }),
        fetch(`${API_BASE}/products`),
      ])
      if (!rS.ok) {
        setErro(await lerErroApi(rS))
        return
      }
      if (!rI.ok || !rP.ok) {
        setErro(!rI.ok ? await lerErroApi(rI) : await lerErroApi(rP))
        return
      }
      const [jS, jI, jP] = await Promise.all([rS.json(), rI.json(), rP.json()])
      setSales(Array.isArray(jS) ? (jS as Sale[]) : [])
      setSaleItems(Array.isArray(jI) ? (jI as SaleItem[]) : [])
      const rows = Array.isArray(jP) ? (jP as Product[]) : []
      setProducts(rows.map((p) => ({ product_id: p.product_id, name: p.name })))
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('minhas-compras-route')
    return () => document.documentElement.classList.remove('minhas-compras-route')
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const productMap = useMemo(() => {
    const m = new Map<number, string>()
    for (const p of products) m.set(p.product_id, p.name)
    return m
  }, [products])

  const comprasOrdenadas = useMemo(() => {
    if (userId === null) return []
    const lista = sales.filter((s) => obterClienteUserIdDaVenda(s) === userId)
    return lista.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }, [sales, userId])

  const itensPorVenda = useMemo(() => {
    const m = new Map<number, SaleItem[]>()
    for (const it of saleItems) {
      const arr = m.get(it.sale_id) ?? []
      arr.push(it)
      m.set(it.sale_id, arr)
    }
    return m
  }, [saleItems])

  return (
    <div className="minhas-compras-page">
      <header className="minhas-compras-header">
        <div>
          <h1 className="minhas-compras-titulo">Minhas compras</h1>
        </div>
        <button
          type="button"
          className="minhas-compras-btn-atualizar"
          onClick={() => void carregar()}
          disabled={carregando}
        >
          Atualizar
        </button>
      </header>

      <main className="minhas-compras-main">
        {userId === null ? (
          <p className="minhas-compras-aviso" role="alert">
            Não foi possível identificar o utilizador em sessão. Volte ao login.
          </p>
        ) : null}
        {erro ? (
          <div className="minhas-compras-erro" role="alert">
            {erro}
          </div>
        ) : null}
        {carregando ? (
          <p className="minhas-compras-vazio">A carregar compras…</p>
        ) : comprasOrdenadas.length === 0 ? (
          <p className="minhas-compras-vazio">
            Ainda não tem compras registadas com esta conta.
          </p>
        ) : (
          <ul className="minhas-compras-lista">
            {comprasOrdenadas.map((v) => {
              const itens = itensPorVenda.get(v.sale_id) ?? []
              const total = totalVendaLinha(v)
              return (
                <li key={v.sale_id} className="minhas-compras-card">
                  <div className="minhas-compras-card-top">
                    <div>
                      <span className="minhas-compras-label">Venda</span>{' '}
                      <strong>#{v.sale_id}</strong>
                      <span className="minhas-compras-sep">·</span>
                      <time dateTime={v.created_at}>
                        {formatarDataHora(v.created_at)}
                      </time>
                    </div>
                    <div className="minhas-compras-total">{formatBRL(total)}</div>
                  </div>
                  {itens.length > 0 ? (
                    <table className="minhas-compras-itens">
                      <thead>
                        <tr>
                          <th scope="col">Produto</th>
                          <th scope="col" className="num">
                            Qtd.
                          </th>
                          <th scope="col" className="num">
                            Subtotal
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {itens.map((it) => {
                          const o = it as Record<string, unknown>
                          const qtd = Math.floor(
                            parseNumeroApi(it.quantity ?? o.qty ?? o.quantity),
                          )
                          const sub = parseNumeroApi(
                            it.subtotal ?? o.subTotal ?? o.valor_subtotal,
                          )
                          const nome =
                            productMap.get(it.product_id) ??
                            `Produto #${it.product_id}`
                          return (
                            <tr key={it.sale_item_id}>
                              <td>{nome}</td>
                              <td className="num">{qtd}</td>
                              <td className="num">{formatBRL(sub)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="minhas-compras-sem-itens">
                      Sem linhas de itens associadas a esta venda.
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
