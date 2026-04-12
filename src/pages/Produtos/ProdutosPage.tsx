/**
 * @fileoverview Gestão de produtos (estoque): colaboradores usam formulário e lista com edição;
 * clientes (`user_type` em sessão) vêem apenas o catálogo.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { isClienteLogado } from '../../lib/sessao'
import './ProdutosPage.css'

/** Resposta de `GET/POST/PUT /products` alinhada ao backend (`shared/types`). */
type ApiProduct = {
  product_id: number
  name: string
  description: string | null
  quantity: number
  price: number
  created_at: string
  updated_at: string | null
}

/**
 * Converte número vindo da API (número, string pt-BR/en, DECIMAL MySQL, etc.).
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
 * Normaliza uma linha de `GET /products` para `ApiProduct` (preço/quantidade sempre números usáveis no formulário).
 */
function normalizarProdutoLista(row: unknown): ApiProduct | null {
  if (typeof row !== 'object' || row === null) return null
  const o = row as Record<string, unknown>
  const idRaw = o.product_id ?? o.productId ?? o.id
  const id = typeof idRaw === 'number' ? idRaw : Number(idRaw)
  if (!Number.isInteger(id) || id <= 0) return null

  const nameRaw = o.name
  const name =
    typeof nameRaw === 'string'
      ? nameRaw.trim()
      : String(nameRaw ?? '').trim()

  const desc = o.description
  const description =
    desc === null || desc === undefined
      ? null
      : typeof desc === 'string'
        ? desc
        : String(desc)

  const priceRaw =
    o.price ?? o.unit_price ?? o.unitPrice ?? o.preco ?? o.valor
  const price = parseNumeroApi(priceRaw)

  const qtyRaw =
    o.quantity ?? o.stock ?? o.qty ?? o.quantidade ?? o.amount
  const quantity = Math.max(0, Math.floor(parseNumeroApi(qtyRaw)))

  const created =
    typeof o.created_at === 'string'
      ? o.created_at
      : typeof o.createdAt === 'string'
        ? o.createdAt
        : ''
  const updatedRaw = o.updated_at ?? o.updatedAt
  const updated_at =
    updatedRaw === null || updatedRaw === undefined
      ? null
      : typeof updatedRaw === 'string'
        ? updatedRaw
        : null

  return {
    product_id: id,
    name: name.length > 0 ? name : '(sem nome)',
    description,
    quantity,
    price: Number.isFinite(price) ? price : 0,
    created_at: created,
    updated_at,
  }
}

/** Corpo JSON de erro da API. */
type ApiErrorBody = { error?: string }

/**
 * Interpreta preço em texto pt-BR (vírgula decimal, ponto opcional como milhar).
 * @param valor Texto do campo de preço.
 * @returns Número ≥ 0 ou `null` se inválido.
 */
function parsePrecoBr(valor: string): number | null {
  const t = valor.trim().replace(/\./g, '').replace(',', '.')
  if (t === '') return null
  const n = Number.parseFloat(t)
  if (Number.isNaN(n) || n < 0) return null
  return n
}

/** Formata número com duas casas decimais e vírgula (exibição em formulário). */
function formatarPrecoBr(num: number): string {
  const n = typeof num === 'number' && Number.isFinite(num) ? num : 0
  return n.toFixed(2).replace('.', ',')
}

/** Apenas dígitos e uma vírgula decimal (até 2 casas após a vírgula). */
function sanitizarPrecoInput(valor: string): string {
  const soPermitidos = valor.replace(/[^\d,]/g, '')
  const idx = soPermitidos.indexOf(',')
  if (idx === -1) return soPermitidos
  const intPart = soPermitidos.slice(0, idx).replace(/\D/g, '')
  const decPart = soPermitidos
    .slice(idx + 1)
    .replace(/\D/g, '')
    .slice(0, 2)
  if (decPart.length > 0) return `${intPart},${decPart}`
  return intPart + ','
}

/** Apenas dígitos (quantidade inteira ≥ 0). */
function sanitizarQuantidadeInput(valor: string): string {
  return valor.replace(/\D/g, '')
}

/** Formata valor em BRL para tabelas e totais. */
function formatarPrecoExibicao(num: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(num)
}

/**
 * Lê mensagem de erro de uma resposta HTTP da API de produtos.
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
 * Texto de disponibilidade para o catálogo do cliente (sem revelar stock exato).
 * @param quantidade Stock real do produto.
 * @returns `"Fora de estoque"`, `"Estoque baixo"` (1–5) ou `"Disponível"` (>5).
 */
function rotuloDisponibilidadeCliente(quantidade: number): string {
  if (quantidade <= 0) return 'Fora de estoque'
  if (quantidade <= 5) return 'Estoque baixo'
  return 'Disponível'
}

/**
 * Página de cadastro e listagem de produtos com validação de campos e chamadas REST.
 * @returns UI de gestão de estoque.
 */
export function ProdutosPage() {
  const clienteLogado = useMemo(() => isClienteLogado(), [])
  const [produtos, setProdutos] = useState<ApiProduct[]>([])
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [precoStr, setPrecoStr] = useState('')
  const [quantidadeStr, setQuantidadeStr] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [erros, setErros] = useState<{
    nome?: string
    preco?: string
    quantidade?: string
    api?: string
  }>({})
  const [listaCarregando, setListaCarregando] = useState(true)
  const [listaErro, setListaErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  /** Atualiza `produtos` a partir de `GET /products`. */
  const recarregarLista = useCallback(async () => {
    setListaCarregando(true)
    setListaErro(null)
    try {
      const res = await fetch(`${API_BASE}/products`)
      if (!res.ok) {
        setProdutos([])
        setListaErro(await lerErroApi(res))
        return
      }
      const payload = (await res.json()) as unknown
      const rows = Array.isArray(payload) ? payload : []
      setProdutos(
        rows
          .map((row) => normalizarProdutoLista(row))
          .filter((p): p is ApiProduct => p !== null),
      )
    } catch {
      setProdutos([])
      setListaErro('Não foi possível carregar os produtos.')
    } finally {
      setListaCarregando(false)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('produtos-route')
    return () => document.documentElement.classList.remove('produtos-route')
  }, [])

  useEffect(() => {
    void recarregarLista()
  }, [recarregarLista])

  /** Limpa o formulário e o modo edição. */
  const resetForm = useCallback(() => {
    setNome('')
    setDescricao('')
    setPrecoStr('')
    setQuantidadeStr('')
    setEditingId(null)
    setErros({})
  }, [])

  /** Cria ou atualiza produto via `POST /products` ou `PUT /products/:id`. */
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const novosErros: typeof erros = {}
    if (!nome.trim()) novosErros.nome = 'Informe o nome.'
    const preco = parsePrecoBr(precoStr)
    if (preco === null) novosErros.preco = 'Informe um preço válido (ex.: 12,90).'
    const q = Number.parseInt(quantidadeStr.trim(), 10)
    if (quantidadeStr.trim() === '' || Number.isNaN(q) || q < 0) {
      novosErros.quantidade = 'Informe uma quantidade válida (≥ 0).'
    }
    setErros(novosErros)
    if (Object.keys(novosErros).length > 0) return
    if (preco === null) return

    const descTrim = descricao.trim()
    const description = descTrim.length > 0 ? descTrim : null

    try {
      setSalvando(true)
      setErros((prev) => ({ ...prev, api: undefined }))
      if (editingId !== null) {
        const res = await fetch(`${API_BASE}/products/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: nome.trim(),
            description,
            quantity: q,
            price: preco,
          }),
        })
        if (!res.ok) {
          setErros({ api: await lerErroApi(res) })
          return
        }
      } else {
        const res = await fetch(`${API_BASE}/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: nome.trim(),
            description,
            quantity: q,
            price: preco,
          }),
        })
        if (!res.ok) {
          setErros({ api: await lerErroApi(res) })
          return
        }
      }
      await recarregarLista()
      resetForm()
    } catch {
      setErros({
        api: 'Não foi possível conectar ao servidor. Tente novamente.',
      })
    } finally {
      setSalvando(false)
    }
  }

  /** Preenche o formulário com os dados do produto selecionado para edição. */
  const iniciarEdicao = (p: ApiProduct) => {
    setEditingId(p.product_id)
    setNome(p.name)
    setDescricao(p.description ?? '')
    setPrecoStr(formatarPrecoBr(p.price))
    setQuantidadeStr(String(Math.max(0, Math.floor(p.quantity))))
    setErros({})
  }

  /** Remove produto com confirmação (`DELETE /products/:id`). */
  const remover = async (id: number) => {
    if (!window.confirm('Remover este produto do servidor?')) return
    try {
      const res = await fetch(`${API_BASE}/products/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        window.alert(await lerErroApi(res))
        return
      }
      if (editingId === id) resetForm()
      await recarregarLista()
    } catch {
      window.alert('Não foi possível remover o produto.')
    }
  }

  return (
    <div className="produtos-page">
      <header className="produtos-header">
        <div>
          <h1 className="produtos-titulo">Produtos</h1>
        </div>
      </header>

      <div
        className={`produtos-layout${clienteLogado ? ' produtos-layout--cliente' : ''}`}
      >
        {!clienteLogado ? (
        <section
          className="produtos-card"
          aria-labelledby="adicionar-produto-titulo"
        >
          <h2 id="adicionar-produto-titulo" className="produtos-card-titulo">
            Adicionar produto
          </h2>
          <form className="produtos-form" onSubmit={handleSubmit} noValidate>
            {erros.api ? (
              <p className="erro-campo erro-api" role="alert">
                {erros.api}
              </p>
            ) : null}
            <div className="campo">
              <label htmlFor="prod-nome">Nome</label>
              <input
                id="prod-nome"
                type="text"
                placeholder="Ex: Parafuso 8mm"
                value={nome}
                onChange={(ev) => setNome(ev.target.value)}
                aria-invalid={Boolean(erros.nome)}
              />
              {erros.nome ? (
                <span className="erro-campo">{erros.nome}</span>
              ) : null}
            </div>
            <div className="campo">
              <label htmlFor="prod-desc">Descrição (opcional)</label>
              <textarea
                id="prod-desc"
                className="produtos-textarea"
                placeholder="Detalhes do produto…"
                rows={3}
                value={descricao}
                onChange={(ev) => setDescricao(ev.target.value)}
              />
            </div>
            <div className="campo">
              <label htmlFor="prod-preco">Preço (R$)</label>
              <input
                id="prod-preco"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={precoStr}
                onChange={(ev) =>
                  setPrecoStr(sanitizarPrecoInput(ev.target.value))
                }
                aria-invalid={Boolean(erros.preco)}
              />
              {erros.preco ? (
                <span className="erro-campo">{erros.preco}</span>
              ) : null}
            </div>
            <div className="campo">
              <label htmlFor="prod-qtd">Quantidade</label>
              <input
                id="prod-qtd"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                value={quantidadeStr}
                onChange={(ev) =>
                  setQuantidadeStr(sanitizarQuantidadeInput(ev.target.value))
                }
                aria-invalid={Boolean(erros.quantidade)}
              />
              {erros.quantidade ? (
                <span className="erro-campo">{erros.quantidade}</span>
              ) : null}
            </div>
            <button type="submit" className="btn-adicionar" disabled={salvando}>
              {salvando
                ? 'Salvando…'
                : editingId !== null
                  ? 'Salvar alterações'
                  : 'Adicionar'}
            </button>
            {editingId !== null ? (
              <button
                type="button"
                className="btn-cancelar-edicao"
                onClick={resetForm}
              >
                Cancelar edição
              </button>
            ) : null}
          </form>
        </section>
        ) : null}

        <section aria-label="Lista de produtos cadastrados">
          <div className="lista-produtos-header">
            <button
              type="button"
              className="btn-limpar"
              onClick={() => void recarregarLista()}
              disabled={listaCarregando}
            >
              Atualizar lista
            </button>
          </div>

          {listaErro ? (
            <div className="lista-erro" role="alert">
              {listaErro}
            </div>
          ) : null}

          {listaCarregando ? (
            <div className="lista-vazia">Carregando produtos…</div>
          ) : produtos.length === 0 ? (
            <div className="lista-vazia">
              {clienteLogado
                ? 'Nenhum produto disponível no catálogo.'
                : 'Nenhum produto cadastrado. Use o formulário ao lado para criar no servidor.'}
            </div>
          ) : (
            <div className="grid-produtos">
              {produtos.map((p) => (
                <article key={p.product_id} className="card-produto">
                  <div className="card-produto-info">
                    <h3 className="card-produto-nome" title={p.name}>
                      {p.name}
                    </h3>
                    <p className="card-produto-meta">
                      Preço: {formatarPrecoExibicao(p.price)}
                      <br />
                      {clienteLogado ? (
                        <span
                          className={
                            p.quantity <= 0
                              ? 'card-produto-estado card-produto-estado--fora'
                              : p.quantity <= 5
                                ? 'card-produto-estado card-produto-estado--acabando'
                                : 'card-produto-estado card-produto-estado--ok'
                          }
                        >
                          {rotuloDisponibilidadeCliente(p.quantity)}
                        </span>
                      ) : (
                        <>Quantidade: {p.quantity}</>
                      )}
                      {p.description ? (
                        <>
                          <br />
                          <span className="card-produto-desc">
                            {p.description}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {!clienteLogado ? (
                    <div className="card-produto-acoes">
                      <button
                        type="button"
                        className="btn-editar"
                        onClick={() => iniciarEdicao(p)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn-remover"
                        onClick={() => void remover(p.product_id)}
                      >
                        Remover
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
