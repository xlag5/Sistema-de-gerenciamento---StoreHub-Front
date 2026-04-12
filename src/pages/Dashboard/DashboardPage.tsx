/**
 * @fileoverview Dashboard de vendas e estoque: KPIs, gráfico temporal, ranking de produtos,
 * clientes do mês e resumo de stock a partir de `GET /sales`, `/sale-items`, `/products` e `/users`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { cabecalhosAuthBearer } from '../../lib/sessao'
import {
  RankingClientesMes,
  type LinhaRankingClienteMes,
} from './RankingClientesMes'
import './DashboardPage.css'

/** Linha de venda alinhada ao backend v2 (`sales`): vendedor + cliente + total. */
type Sale = {
  sale_id: number
  seller_id?: number
  user_id_cliente?: number
  /** Legado. */
  user_id?: number
  total_value?: number
  created_at: string
} & Record<string, unknown>

/** Linha de item de venda associada a `sale_id`. */
type SaleItem = {
  sale_item_id: number
  sale_id: number
  product_id: number
  quantity?: number
  unit_price?: number
  subtotal?: number
} & Record<string, unknown>

/** Produto simplificado para stock e nomes no ranking. */
type Product = {
  product_id: number
  name: string
  quantity: number
  price: number
}

/** Linha mínima de `GET /users` para nomes no ranking de clientes. */
type UsuarioListaNome = {
  user_id: number
  nome: string
}

/** Corpo JSON de erro da API. */
type ApiErrorBody = { error?: string }

/** Modo de agregação temporal do gráfico de faturamento. */
type Agrupar = 'dia' | 'semana' | 'mes'

/**
 * Converte valores de API (número ou string, pt-BR ou EN) num número finito.
 * @param v Valor bruto de JSON ou formulário.
 * @returns Número finito ou `0` se inválido.
 */
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

/**
 * Obtém o total monetário de uma venda independentemente do nome do campo na API.
 * @param s Linha de venda (pode incluir chaves extra em `Record`).
 */
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

/**
 * Formata número como moeda BRL; valores não finitos tornam-se `0`.
 * @param n Valor a formatar.
 */
function formatBRL(n: number): string {
  const x = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(x)
}

/** Formata inteiro com separadores pt-BR. */
function formatInt(n: number): string {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 0,
  }).format(n)
}

/**
 * Extrai mensagem de erro legível de uma resposta HTTP.
 * @param res Resposta `fetch` (tipicamente não OK).
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
  return 'Erro ao carregar dados.'
}

/**
 * Converte ISO 8601 em `Date` local; inválido devolve época (0).
 * @param iso String de data/hora.
 */
function parseDataLocal(iso: string): Date {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? new Date(0) : d
}

/** Início do dia civil local (00:00:00.000) para a data dada. */
function inicioDoDiaLocal(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Indica se duas datas coincidem no mesmo dia civil local. */
function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Indica se duas datas estão no mesmo mês e ano civil. */
function mesmoMes(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

/** Cliente da venda: `user_id_cliente` (API v2) ou `user_id` (legado). */
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
 * Normaliza o array de `GET /users` para `{ user_id, nome }`.
 */
function normalizarUsuariosParaNomes(payload: unknown): UsuarioListaNome[] {
  if (!Array.isArray(payload)) return []
  const out: UsuarioListaNome[] = []
  for (const row of payload) {
    if (typeof row !== 'object' || row === null) continue
    const o = row as Record<string, unknown>
    const idRaw = o.user_id
    const id =
      typeof idRaw === 'number' ? idRaw : Number.parseInt(String(idRaw), 10)
    if (!Number.isInteger(id) || id <= 0) continue
    const nomeStr =
      typeof o.nome === 'string' && o.nome.trim()
        ? o.nome.trim()
        : typeof o.email === 'string' && o.email.trim()
          ? o.email.trim()
          : `Utilizador #${id}`
    out.push({ user_id: id, nome: nomeStr })
  }
  return out
}

/**
 * Chave estável para agrupar vendas (dia `YYYY-MM-DD`, mês `YYYY-MM`, semana `sem-YYYY-MM-DD` da segunda-feira).
 * @param data Instante da venda.
 * @param modo Granularidade do eixo temporal.
 */
function chaveAgrupamento(data: Date, modo: Agrupar): string {
  if (modo === 'dia') {
    const y = data.getFullYear()
    const m = String(data.getMonth() + 1).padStart(2, '0')
    const da = String(data.getDate()).padStart(2, '0')
    return `${y}-${m}-${da}`
  }
  if (modo === 'mes') {
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`
  }
  const d = new Date(data)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d.setDate(diff))
  monday.setHours(0, 0, 0, 0)
  const y = monday.getFullYear()
  const m = String(monday.getMonth() + 1).padStart(2, '0')
  const da = String(monday.getDate()).padStart(2, '0')
  return `sem-${y}-${m}-${da}`
}

/**
 * Rótulo curto para o eixo X do gráfico a partir da chave de agrupamento.
 * @param chave Chave devolvida por {@link chaveAgrupamento}.
 * @param modo Modo de agrupamento ativo.
 */
function labelEixoX(chave: string, modo: Agrupar): string {
  if (modo === 'mes') {
    const [y, m] = chave.split('-')
    return `${m}/${y?.slice(2) ?? ''}`
  }
  if (modo === 'semana' && chave.startsWith('sem-')) {
    const rest = chave.slice(4)
    const [, m, da] = rest.split('-')
    return `${da}/${m}`
  }
  const [, m, da] = chave.split('-')
  return `${da}/${m}`
}

/**
 * Gráfico de área/linha em SVG com grelha e legenda de faturamento.
 * @param props.pontos Séries ordenadas `{ chave, valor, label }` para o eixo.
 */
function GraficoVendas({
  pontos,
}: {
  pontos: { chave: string; valor: number; label: string }[]
}) {
  const W = 640
  const H = 260
  const pad = { t: 28, r: 20, b: 40, l: 56 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const maxV = Math.max(1, ...pontos.map((p) => p.valor))
  const n = pontos.length
  const coords = pontos.map((p, i) => {
    const x = pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
    const y = pad.t + ih - (p.valor / maxV) * ih
    return { x, y, ...p }
  })
  const lineD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ')
  const areaD =
    coords.length > 0
      ? `${lineD} L ${coords[coords.length - 1].x} ${pad.t + ih} L ${coords[0].x} ${pad.t + ih} Z`
      : ''
  const ticksY = 5
  const gridLines = []
  for (let i = 0; i <= ticksY; i++) {
    const v = (maxV * i) / ticksY
    const y = pad.t + ih - (i / ticksY) * ih
    gridLines.push(
      <g key={i}>
        <line
          x1={pad.l}
          y1={y}
          x2={W - pad.r}
          y2={y}
          stroke="#e2e8f0"
          strokeWidth={1}
        />
        <text
          x={pad.l - 8}
          y={y + 4}
          textAnchor="end"
          fontSize="11"
          fill="#64748b"
        >
          {formatBRL(v)}
        </text>
      </g>,
    )
  }

  return (
    <div className="dashboard-chart-wrap">
      <div className="dashboard-chart-legend">
        <span>
          <i /> Faturamento (R$)
        </span>
      </div>
      <svg
        className="dashboard-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <linearGradient id="db-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridLines}
        {areaD ? (
          <path d={areaD} fill="url(#db-area-grad)" stroke="none" />
        ) : null}
        {lineD ? (
          <path
            d={lineD}
            fill="none"
            stroke="#2563eb"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {coords.map((c, i) => (
          <circle key={c.chave + i} cx={c.x} cy={c.y} r={4} fill="#2563eb" />
        ))}
        {coords.map((c) => (
          <text
            key={`t-${c.chave}`}
            x={c.x}
            y={H - 10}
            textAnchor="middle"
            fontSize="10"
            fill="#64748b"
          >
            {c.label}
          </text>
        ))}
      </svg>
    </div>
  )
}

/**
 * Página do painel: carrega dados da API, calcula KPIs e renderiza gráfico e tabelas.
 * @returns Conteúdo do dashboard.
 */
export function DashboardPage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [saleItems, setSaleItems] = useState<SaleItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [usuariosNomes, setUsuariosNomes] = useState<UsuarioListaNome[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [agrupamento, setAgrupamento] = useState<Agrupar>('dia')

  /** Obtém vendas, itens, produtos e utilizadores (nomes) em paralelo. */
  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const authSales = cabecalhosAuthBearer()
      const [rS, rI, rP, rU] = await Promise.all([
        fetch(`${API_BASE}/sales`, { headers: { ...authSales } }),
        fetch(`${API_BASE}/sale-items`, { headers: { ...authSales } }),
        fetch(`${API_BASE}/products`),
        fetch(`${API_BASE}/users`),
      ])
      if (!rS.ok) {
        setErro(await lerErroApi(rS))
        return
      }
      if (!rI.ok || !rP.ok) {
        const msg = !rI.ok ? await lerErroApi(rI) : await lerErroApi(rP)
        setErro(msg)
        return
      }
      const [jS, jI, jP] = await Promise.all([rS.json(), rI.json(), rP.json()])
      setSales(Array.isArray(jS) ? (jS as Sale[]) : [])
      setSaleItems(Array.isArray(jI) ? (jI as SaleItem[]) : [])
      setProducts(Array.isArray(jP) ? (jP as Product[]) : [])
      if (rU.ok) {
        const jU: unknown = await rU.json()
        setUsuariosNomes(normalizarUsuariosParaNomes(jU))
      } else {
        setUsuariosNomes([])
      }
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('dashboard-route')
    return () => document.documentElement.classList.remove('dashboard-route')
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const agora = useMemo(() => new Date(), [])
  const inicioHoje = useMemo(() => inicioDoDiaLocal(agora), [agora])

  const etiquetaMesAtual = useMemo(() => {
    const s = new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
    }).format(inicioHoje)
    return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
  }, [inicioHoje])

  const kpis = useMemo(() => {
    let fatHoje = 0
    let fatMes = 0
    let vendasMes = 0
    let qtdProdutosMes = 0
    for (const s of sales) {
      const d = parseDataLocal(s.created_at)
      const tv = totalVendaLinha(s)
      if (mesmoDia(d, inicioHoje)) fatHoje += tv
      if (mesmoMes(d, inicioHoje)) {
        fatMes += tv
        vendasMes += 1
      }
    }
    const idsMes = new Set(
      sales.filter((s) => mesmoMes(parseDataLocal(s.created_at), inicioHoje)).map((s) => s.sale_id),
    )
    for (const it of saleItems) {
      if (idsMes.has(it.sale_id)) {
        const o = it as Record<string, unknown>
        qtdProdutosMes += Math.floor(
          parseNumeroApi(it.quantity ?? o.qty ?? o.quantity),
        )
      }
    }
    const ticket = vendasMes > 0 ? fatMes / vendasMes : 0
    return {
      fatHoje,
      fatMes,
      vendasMes,
      qtdProdutosMes,
      ticket,
    }
  }, [sales, saleItems, inicioHoje])

  const pontosGrafico = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const s of sales) {
      const d = parseDataLocal(s.created_at)
      const k = chaveAgrupamento(d, agrupamento)
      mapa.set(k, (mapa.get(k) ?? 0) + totalVendaLinha(s))
    }
    const chaves = [...mapa.keys()].sort()
    if (chaves.length === 0) {
      const hoje = chaveAgrupamento(agora, agrupamento)
      return [{ chave: hoje, valor: 0, label: labelEixoX(hoje, agrupamento) }]
    }
    return chaves.map((chave) => ({
      chave,
      valor: mapa.get(chave) ?? 0,
      label: labelEixoX(chave, agrupamento),
    }))
  }, [sales, agrupamento, agora])

  const rankingClientesMes = useMemo((): LinhaRankingClienteMes[] => {
    const nomeDe = (userId: number) =>
      usuariosNomes.find((u) => u.user_id === userId)?.nome ?? `Cliente #${userId}`

    const agg = new Map<number, { total: number; vendas: number }>()
    for (const s of sales) {
      const d = parseDataLocal(s.created_at)
      if (!mesmoMes(d, inicioHoje)) continue
      const cid = obterClienteUserIdDaVenda(s)
      if (cid === null) continue
      const tv = totalVendaLinha(s)
      const cur = agg.get(cid) ?? { total: 0, vendas: 0 }
      cur.total += tv
      cur.vendas += 1
      agg.set(cid, cur)
    }
    return [...agg.entries()]
      .map(([user_id, v]) => ({
        user_id,
        nome: nomeDe(user_id),
        vendasNoMes: v.vendas,
        totalNoMes: v.total,
      }))
      .sort(
        (a, b) =>
          b.totalNoMes - a.totalNoMes ||
          b.vendasNoMes - a.vendasNoMes ||
          a.nome.localeCompare(b.nome, 'pt-BR'),
      )
      .slice(0, 12)
  }, [sales, usuariosNomes, inicioHoje])

  const produtosMaisVendidos = useMemo(() => {
    const agg = new Map<number, { q: number; receita: number }>()
    for (const it of saleItems) {
      const o = it as Record<string, unknown>
      const qtd = parseNumeroApi(it.quantity ?? o.qty ?? o.quantity)
      const sub = parseNumeroApi(it.subtotal ?? o.subTotal ?? o.valor_subtotal)
      const x = agg.get(it.product_id) ?? { q: 0, receita: 0 }
      x.q += Math.floor(qtd)
      x.receita += sub
      agg.set(it.product_id, x)
    }
    const list = [...agg.entries()]
      .map(([product_id, v]) => ({
        product_id,
        nome:
          products.find((p) => p.product_id === product_id)?.name ??
          `Produto #${product_id}`,
        ...v,
      }))
      .sort((a, b) => b.q - a.q)
      .slice(0, 12)
    return list
  }, [saleItems, products])

  const estoqueResumo = useMemo(() => {
    let baixo = 0
    let zero = 0
    let totalUnidades = 0
    const listaBaixo: Product[] = []
    const listaZero: Product[] = []
    for (const p of products) {
      totalUnidades += p.quantity
      if (p.quantity === 0) {
        zero += 1
        listaZero.push(p)
      } else if (p.quantity <= 5) {
        baixo += 1
        listaBaixo.push(p)
      }
    }
    return { baixo, zero, totalUnidades, listaBaixo, listaZero }
  }, [products])

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-titulo">Dashboard</h1>
          <p className="dashboard-subtitulo">
            Visão geral de vendas e estoque com dados do servidor (vendas,
            itens e produtos).
          </p>
        </div>
        <nav className="dashboard-nav" aria-label="Ações do dashboard">
          <button type="button" className="nav-pill" onClick={() => void carregar()}>
            Atualizar
          </button>
        </nav>
      </header>

      <main className="dashboard-main">
        {erro ? <div className="dashboard-erro">{erro}</div> : null}
        {carregando ? (
          <p className="dashboard-vazio">A carregar dados…</p>
        ) : (
          <>
            <p className="dashboard-kpi-label">INDICADORES</p>
            <div className="dashboard-kpi-grid">
              <div className="dashboard-kpi-card">
                <div className="dashboard-kpi-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <p className="dashboard-kpi-titulo">Faturamento (hoje)</p>
                <p className="dashboard-kpi-valor">{formatBRL(kpis.fatHoje)}</p>
              </div>
              <div className="dashboard-kpi-card">
                <div className="dashboard-kpi-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                </div>
                <p className="dashboard-kpi-titulo">Faturamento (mês)</p>
                <p className="dashboard-kpi-valor">{formatBRL(kpis.fatMes)}</p>
              </div>
              <div className="dashboard-kpi-card">
                <div className="dashboard-kpi-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="9" cy="21" r="1" />
                    <circle cx="20" cy="21" r="1" />
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                  </svg>
                </div>
                <p className="dashboard-kpi-titulo">Vendas (mês)</p>
                <p className="dashboard-kpi-valor">{formatInt(kpis.vendasMes)}</p>
              </div>
              <div className="dashboard-kpi-card">
                <div className="dashboard-kpi-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  </svg>
                </div>
                <p className="dashboard-kpi-titulo">Produtos vendidos (mês)</p>
                <p className="dashboard-kpi-valor">
                  {formatInt(kpis.qtdProdutosMes)}
                </p>
              </div>
              <div className="dashboard-kpi-card">
                <div className="dashboard-kpi-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                    <path d="M2 10h20" />
                  </svg>
                </div>
                <p className="dashboard-kpi-titulo">Ticket médio (mês)</p>
                <p className="dashboard-kpi-valor">{formatBRL(kpis.ticket)}</p>
              </div>
            </div>

            <section className="dashboard-card" aria-labelledby="grafico-titulo">
              <div className="dashboard-card-cabecalho">
                <div>
                  <h2 id="grafico-titulo" className="dashboard-card-titulo">
                    Vendas ao longo do tempo
                  </h2>
                  <p className="dashboard-card-sub">
                    Faturamento agregado por período (histórico de vendas registadas)
                  </p>
                </div>
                <label className="dashboard-card-sub">
                  Agrupar por{' '}
                  <select
                    className="dashboard-select"
                    value={agrupamento}
                    onChange={(e) => setAgrupamento(e.target.value as Agrupar)}
                  >
                    <option value="dia">Dia</option>
                    <option value="semana">Semana</option>
                    <option value="mes">Mês</option>
                  </select>
                </label>
              </div>
              <GraficoVendas pontos={pontosGrafico} />
            </section>

            <RankingClientesMes
              linhas={rankingClientesMes}
              etiquetaMes={etiquetaMesAtual}
              formatBRL={formatBRL}
              formatInt={formatInt}
            />

            <div className="dashboard-split">
              <section className="dashboard-card" aria-labelledby="prod-titulo">
                <h2 id="prod-titulo" className="dashboard-card-titulo">
                  Produtos mais vendidos
                </h2>
                <p className="dashboard-card-sub">
                  Nome, quantidade e receita (todos os itens de venda registados)
                </p>
                {produtosMaisVendidos.length === 0 ? (
                  <p className="dashboard-vazio">Sem vendas de produtos ainda.</p>
                ) : (
                  <table className="dashboard-tabela">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">Produto</th>
                        <th scope="col" className="num">
                          Qtd.
                        </th>
                        <th scope="col" className="num">
                          Receita
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {produtosMaisVendidos.map((row, i) => (
                        <tr key={row.product_id}>
                          <td>{i + 1}</td>
                          <td>{row.nome}</td>
                          <td className="num">{formatInt(row.q)}</td>
                          <td className="num">{formatBRL(row.receita)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="dashboard-card" aria-labelledby="est-titulo">
                <h2 id="est-titulo" className="dashboard-card-titulo">
                  Estoque
                </h2>
                <p className="dashboard-card-sub">
                  Aviso: ≤ 5 unidades (exceto zero). Total de unidades em estoque.
                </p>
                <div className="dashboard-estoque-chips">
                  <div className="dashboard-chip dashboard-chip-warn">
                    <span>Estoque baixo</span>
                    <span className="dashboard-chip-valor">
                      {estoqueResumo.baixo}
                    </span>
                    <span className="dashboard-chip-label">produtos</span>
                  </div>
                  <div className="dashboard-chip dashboard-chip-danger">
                    <span>Sem estoque</span>
                    <span className="dashboard-chip-valor">
                      {estoqueResumo.zero}
                    </span>
                    <span className="dashboard-chip-label">produtos</span>
                  </div>
                  <div className="dashboard-chip dashboard-chip-ok">
                    <span>Total em estoque</span>
                    <span className="dashboard-chip-valor">
                      {formatInt(estoqueResumo.totalUnidades)}
                    </span>
                    <span className="dashboard-chip-label">unidades</span>
                  </div>
                </div>
                <div className="dashboard-estoque-colunas">
                  <div>
                    <h3 className="dashboard-estoque-subtitulo">Estoque baixo</h3>
                    {estoqueResumo.listaBaixo.length === 0 ? (
                      <p className="dashboard-vazio">Nenhum.</p>
                    ) : (
                      estoqueResumo.listaBaixo.map((p) => (
                        <div key={p.product_id} className="dashboard-pill-prod">
                          <strong title={p.name}>{p.name}</strong>
                          <span>{p.quantity} un.</span>
                        </div>
                      ))
                    )}
                  </div>
                  <div>
                    <h3 className="dashboard-estoque-subtitulo">Sem estoque</h3>
                    {estoqueResumo.listaZero.length === 0 ? (
                      <p className="dashboard-vazio">Nenhum.</p>
                    ) : (
                      estoqueResumo.listaZero.map((p) => (
                        <div key={p.product_id} className="dashboard-pill-prod">
                          <strong title={p.name}>{p.name}</strong>
                          <span>0 un.</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
