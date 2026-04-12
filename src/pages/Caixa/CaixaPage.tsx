/**
 * @fileoverview Caixa de vendas: catálogo de produtos, seleção, modal de quantidades e integração com
 * `POST /sales`, `POST /sale-items` e `POST /products/bulk-decrease-stock`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../../lib/apiBase'
import { cabecalhosAuthBearer, obterUserIdLogado } from '../../lib/sessao'
import './CaixaPage.css'

/** Produto tal como devolvido por `GET /products`. */
type ApiProduct = {
  product_id: number
  name: string
  description: string | null
  quantity: number
  price: number
  created_at: string
  updated_at: string | null
}

/** Corpo JSON de erro da API. */
type ApiErrorBody = { error?: string }

/** Uma linha na modal: produto (snapshot) + quantidade a vender editável. */
type LinhaModalVenda = {
  produto: ApiProduct
  quantidadeVenda: number
}

/** Utilizador com `user_type` cliente para o select da modal. */
type ClienteCaixaOpcao = {
  user_id: number
  nome: string
}

/**
 * Formata valor monetário em BRL para exibição.
 * @param num Valor numérico.
 */
function formatarPrecoExibicao(num: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(num)
}

/**
 * Arredonda às duas casas decimais (moeda).
 * @param n Valor bruto.
 */
function arredondarMoeda(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Lê mensagem de erro a partir do corpo JSON de uma resposta HTTP.
 * @param res Resposta `fetch` não OK.
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
 * Garante quantidade inteira entre 0 e o stock disponível.
 * @param valor Quantidade desejada (pode ser decimal).
 * @param estoque Stock máximo permitido.
 */
function clampQuantidadeVenda(valor: number, estoque: number): number {
  if (!Number.isFinite(valor) || valor < 0) return 0
  return Math.min(Math.floor(valor), Math.max(0, Math.floor(estoque)))
}

/**
 * Monta o corpo de `POST /sale-items` e o `total_value` de `POST /sales`:
 * subtotais arredondados por linha e total = soma desses subtotais (evita divergência de arredondamento).
 * @param linhas Linhas da modal com quantidades já validadas.
 * @returns Lista de itens com `unit_price`/`subtotal` arredondados e `total_value` da venda.
 */
function montarPayloadItensEVenda(linhas: LinhaModalVenda[]): {
  itens: Array<{
    product_id: number
    quantity: number
    unit_price: number
    subtotal: number
  }>
  total_value: number
} {
  const itens = linhas.map((l) => {
    const quantity = Math.floor(l.quantidadeVenda)
    const unit_price = arredondarMoeda(l.produto.price)
    const subtotal = arredondarMoeda(unit_price * quantity)
    return {
      product_id: l.produto.product_id,
      quantity,
      unit_price,
      subtotal,
    }
  })
  const total_value = arredondarMoeda(
    itens.reduce((acc, row) => acc + row.subtotal, 0),
  )
  return { itens, total_value }
}

/**
 * Extrai `sale_id` numérico da resposta ao criar uma venda.
 * @param body Corpo JSON já parseado.
 */
function extrairSaleIdDaResposta(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const sid = (body as { sale_id?: unknown }).sale_id
  if (typeof sid === 'number' && Number.isInteger(sid) && sid > 0) return sid
  if (typeof sid === 'string') {
    const n = Number.parseInt(sid, 10)
    if (Number.isInteger(n) && n > 0) return n
  }
  return null
}

/**
 * UI do caixa: grelha de produtos, seleção, modal de resumo e fluxo de confirmação de venda.
 * @returns Página do caixa.
 */
export function CaixaPage() {
  const [produtos, setProdutos] = useState<ApiProduct[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [selecionados, setSelecionados] = useState<Set<number>>(() => new Set())
  const [finalizando, setFinalizando] = useState(false)
  const [alerta, setAlerta] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(
    null,
  )
  const [modalResumoAberta, setModalResumoAberta] = useState(false)
  const [linhasModal, setLinhasModal] = useState<LinhaModalVenda[]>([])
  const [erroModal, setErroModal] = useState<string | null>(null)
  /** `user_id` do cliente escolhido no select `name="cliente"` (obrigatório para `POST /sales`). */
  const [clienteUserId, setClienteUserId] = useState<number | null>(null)
  const [clientesLista, setClientesLista] = useState<ClienteCaixaOpcao[]>([])
  const [clientesCarregando, setClientesCarregando] = useState(false)

  /** Recarrega a lista de produtos a partir de `GET /products`. */
  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch(`${API_BASE}/products`)
      if (!res.ok) {
        setProdutos([])
        setErro(await lerErroApi(res))
        return
      }
      const payload = (await res.json()) as unknown
      const rows = Array.isArray(payload) ? payload : []
      setProdutos(rows as ApiProduct[])
    } catch {
      setProdutos([])
      setErro('Não foi possível carregar os produtos.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('caixa-route')
    return () => document.documentElement.classList.remove('caixa-route')
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  useEffect(() => {
    if (!modalResumoAberta) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !finalizando) {
        setModalResumoAberta(false)
        setErroModal(null)
        setLinhasModal([])
        setClienteUserId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalResumoAberta, finalizando])

  /** Ao abrir a modal, carrega utilizadores e filtra `user_type` cliente (ativos). */
  useEffect(() => {
    if (!modalResumoAberta) return
    let cancelado = false
    setClientesCarregando(true)
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/users`)
        if (!res.ok || cancelado) {
          if (!cancelado) setClientesLista([])
          return
        }
        const data: unknown = await res.json()
        const arr = Array.isArray(data) ? data : []
        const opcoes: ClienteCaixaOpcao[] = []
        for (const row of arr) {
          if (typeof row !== 'object' || row === null) continue
          const o = row as Record<string, unknown>
          const tipo = String(o.user_type ?? '')
            .toLowerCase()
            .trim()
          if (tipo !== 'cliente') continue
          const ativo = o.ativo
          if (typeof ativo === 'number' && ativo === 0) continue
          const uidRaw = o.user_id
          const uid =
            typeof uidRaw === 'number' ? uidRaw : Number.parseInt(String(uidRaw), 10)
          if (!Number.isInteger(uid) || uid <= 0) continue
          const nomeStr =
            typeof o.nome === 'string' && o.nome.trim()
              ? o.nome.trim()
              : typeof o.email === 'string' && o.email.trim()
                ? o.email.trim()
                : `Utilizador #${uid}`
          opcoes.push({ user_id: uid, nome: nomeStr })
        }
        opcoes.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
        if (!cancelado) setClientesLista(opcoes)
      } catch {
        if (!cancelado) setClientesLista([])
      } finally {
        if (!cancelado) setClientesCarregando(false)
      }
    })()
    return () => {
      cancelado = true
    }
  }, [modalResumoAberta])

  /** Inclui ou remove o `product_id` do conjunto de selecionados (respeita modal e finalização). */
  const alternarSelecionado = (id: number) => {
    if (modalResumoAberta || finalizando) return
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setAlerta(null)
  }

  const textoSelecao = useMemo(() => {
    const n = selecionados.size
    if (n === 0) return 'Nenhum item selecionado.'
    if (n === 1) return '1 item selecionado.'
    return `${n} itens selecionados.`
  }, [selecionados])

  /** Alinhado ao `POST /sales` e a cada `POST /sale-items` (mesmos arredondamentos). */
  const payloadModal = useMemo(
    () => montarPayloadItensEVenda(linhasModal),
    [linhasModal],
  )
  const totalModal = payloadModal.total_value

  /** Abre o modal com linhas derivadas dos produtos selecionados (quantidade inicial 1 se houver stock). */
  const abrirModalResumo = () => {
    setAlerta(null)
    setErroModal(null)
    setClienteUserId(null)
    if (selecionados.size === 0) {
      setAlerta({
        tipo: 'erro',
        texto: 'Selecione pelo menos um produto para finalizar a venda.',
      })
      return
    }
    const snapshot = produtos.filter((p) => selecionados.has(p.product_id))
    setLinhasModal(
      snapshot.map((produto) => ({
        produto,
        quantidadeVenda: produto.quantity > 0 ? 1 : 0,
      })),
    )
    setModalResumoAberta(true)
  }

  /** Fecha o modal e limpa linhas temporárias (não durante `finalizando`). */
  const fecharModalResumo = () => {
    if (finalizando) return
    setModalResumoAberta(false)
    setErroModal(null)
    setLinhasModal([])
    setClienteUserId(null)
  }

  /** Atualiza a quantidade de venda de uma linha a partir de texto só com dígitos. */
  const definirQuantidadeLinha = (productId: number, textoBruto: string) => {
    const digitos = textoBruto.replace(/\D/g, '')
    const linha = linhasModal.find((l) => l.produto.product_id === productId)
    if (!linha) return
    const estoque = linha.produto.quantity
    if (digitos === '') {
      setLinhasModal((prev) =>
        prev.map((l) =>
          l.produto.product_id === productId ? { ...l, quantidadeVenda: 0 } : l,
        ),
      )
      return
    }
    const n = Number.parseInt(digitos, 10)
    const q = clampQuantidadeVenda(Number.isNaN(n) ? 0 : n, estoque)
    setLinhasModal((prev) =>
      prev.map((l) =>
        l.produto.product_id === productId ? { ...l, quantidadeVenda: q } : l,
      ),
    )
  }

  /**
   * Valor por omissão na abertura da modal: 1. Se o campo ainda está em 1 e o
   * utilizador foca, limpa para poder digitar outro número; se já alterou (≠1),
   * seleciona o texto para editar sem perder o valor.
   */
  const focoQuantidadeLinha = (
    productId: number,
    valorAtual: number,
    el: HTMLInputElement,
  ) => {
    if (valorAtual === 1) {
      setLinhasModal((prev) =>
        prev.map((l) =>
          l.produto.product_id === productId
            ? { ...l, quantidadeVenda: 0 }
            : l,
        ),
      )
      return
    }
    setTimeout(() => el.select(), 0)
  }

  /** Se ficou vazio ou 0 após editar, repõe 1 quando há stock (comportamento por omissão). */
  const blurQuantidadeLinha = (productId: number) => {
    setLinhasModal((prev) =>
      prev.map((l) => {
        if (l.produto.product_id !== productId) return l
        if (l.quantidadeVenda >= 1) return l
        const max = l.produto.quantity
        return { ...l, quantidadeVenda: max > 0 ? 1 : 0 }
      }),
    )
  }

  /** Cria venda, itens e baixa de stock; trata erros parciais e feedback ao utilizador. */
  const confirmarVenda = async () => {
    setErroModal(null)
    const userId = obterUserIdLogado()
    if (userId === null) {
      setErroModal('É necessário estar logado para confirmar a venda.')
      return
    }

    const invalidas = linhasModal.filter(
      (l) =>
        l.quantidadeVenda < 1 ||
        l.quantidadeVenda > l.produto.quantity ||
        !Number.isInteger(l.quantidadeVenda),
    )
    if (invalidas.length > 0) {
      setErroModal(
        'Defina uma quantidade entre 1 e o estoque disponível para cada linha.',
      )
      return
    }

    if (clienteUserId === null) {
      setErroModal('Selecione o cliente da venda (obrigatório).')
      return
    }

    const { itens, total_value } = montarPayloadItensEVenda(linhasModal)

    try {
      setFinalizando(true)
      const resSale = await fetch(`${API_BASE}/sales`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...cabecalhosAuthBearer(),
        },
        body: JSON.stringify({
          user_id: userId,
          total_value,
          cliente: clienteUserId,
        }),
      })
      if (!resSale.ok) {
        setErroModal(await lerErroApi(resSale))
        return
      }
      const vendaBody: unknown = await resSale.json()
      const sale_id = extrairSaleIdDaResposta(vendaBody)
      if (sale_id === null) {
        setErroModal(
          'Resposta inválida do servidor ao criar a venda (sale_id ausente).',
        )
        return
      }

      for (const item of itens) {
        const resItem = await fetch(`${API_BASE}/sale-items`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...cabecalhosAuthBearer(),
          },
          body: JSON.stringify({
            sale_id,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: item.subtotal,
          }),
        })
        if (!resItem.ok) {
          setErroModal(
            `${await lerErroApi(resItem)} (venda #${sale_id} criada; verifique os itens.)`,
          )
          await carregar()
          return
        }
      }

      const resBulk = await fetch(`${API_BASE}/products/bulk-decrease-stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: itens.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
          })),
        }),
      })
      if (!resBulk.ok) {
        const msgBulk = await lerErroApi(resBulk)
        setModalResumoAberta(false)
        setLinhasModal([])
        setClienteUserId(null)
        setSelecionados(new Set())
        setAlerta({
          tipo: 'erro',
          texto: `${msgBulk} Venda #${sale_id} e itens foram registados, mas a baixa de stock em lote falhou. Ajuste o stock em Estoque (Produtos) se for necessário.`,
        })
        await carregar()
        return
      }

      setModalResumoAberta(false)
      setLinhasModal([])
      setClienteUserId(null)
      setSelecionados(new Set())
      setAlerta({
        tipo: 'sucesso',
        texto: `Venda #${sale_id} registrada com ${itens.length} item(ns). Total: ${formatarPrecoExibicao(total_value)}.`,
      })
      await carregar()
    } catch {
      setErroModal('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setFinalizando(false)
    }
  }

  const userIdLogado = obterUserIdLogado()
  const linhasComProblema = linhasModal.filter(
    (l) =>
      l.quantidadeVenda < 1 ||
      l.quantidadeVenda > l.produto.quantity ||
      l.produto.quantity < 1,
  )
  const confirmarDesabilitado =
    finalizando ||
    linhasModal.length === 0 ||
    userIdLogado === null ||
    clienteUserId === null ||
    linhasComProblema.length > 0

  const finalizarDesabilitado =
    carregando || selecionados.size === 0 || Boolean(erro) || modalResumoAberta

  return (
    <div className="caixa-page">
      <header className="caixa-header">
        <div>
          <h1 className="caixa-titulo">Caixa</h1>
          <ul className="caixa-meta">
            <li>
              Produtos disponíveis no sistema
            </li>
            <li>
              {carregando
                ? 'Carregando…'
                : `${produtos.length} produto${produtos.length === 1 ? '' : 's'}`}
            </li>
            <li>{textoSelecao}</li>
          </ul>
        </div>
      </header>

      {alerta ? (
        <div
          className={`caixa-alerta${alerta.tipo === 'sucesso' ? ' caixa-alerta-sucesso' : ' caixa-alerta-erro'}`}
          role="status"
        >
          {alerta.texto}
        </div>
      ) : null}

      <main className="caixa-main">
        {erro ? (
          <div className="caixa-lista-erro" role="alert">
            {erro}
          </div>
        ) : carregando ? (
          <div className="caixa-lista-vazia">Carregando produtos…</div>
        ) : produtos.length === 0 ? (
          <div className="caixa-lista-vazia">
            Nenhum produto cadastrado. Cadastre em Estoque (Produtos).
          </div>
        ) : (
          <div className="caixa-grid">
            {produtos.map((p) => {
              const inputId = `caixa-prod-${p.product_id}`
              const bloqueado = finalizando || modalResumoAberta
              return (
                <label
                  key={p.product_id}
                  className="caixa-card"
                  htmlFor={inputId}
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    className="caixa-card-checkbox"
                    checked={selecionados.has(p.product_id)}
                    onChange={() => alternarSelecionado(p.product_id)}
                    disabled={bloqueado}
                    aria-label={`Selecionar ${p.name}`}
                  />
                  <div className="caixa-card-body">
                    <h2 className="caixa-card-nome" title={p.name}>
                      {p.name}
                    </h2>
                    <p className="caixa-card-meta">
                      Preço: {formatarPrecoExibicao(p.price)}
                      <br />
                      Quantidade: {p.quantity}
                    </p>
                  </div>
                </label>
              )
            })}
          </div>
        )}
      </main>

      <div className="caixa-finalizar-wrap">
        <button
          type="button"
          className="btn-finalizar"
          disabled={finalizarDesabilitado}
          onClick={abrirModalResumo}
        >
          Finalizar
        </button>
      </div>

      {modalResumoAberta ? (
        <div
          className="caixa-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) fecharModalResumo()
          }}
        >
          <div
            className="caixa-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="caixa-modal-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="caixa-modal-cabecalho">
              <h2 id="caixa-modal-titulo" className="caixa-modal-titulo">
                Resumo da venda
              </h2>
              <button
                type="button"
                className="caixa-modal-fechar"
                onClick={fecharModalResumo}
                disabled={finalizando}
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
            <div className="caixa-modal-corpo">
              {userIdLogado === null ? (
                <p className="caixa-modal-aviso">
                  Nenhum utilizador em sessão.{' '}
                  <Link to="/login">Inicie sessão</Link> para poder confirmar a
                  venda.
                </p>
              ) : null}
              {linhasComProblema.length > 0 ? (
                <p className="caixa-modal-aviso">
                  Ajuste as quantidades: mínimo 1 por linha, máximo igual ao
                  estoque do produto (estoque 0 impede a venda dessa linha).
                </p>
              ) : null}
              {erroModal ? (
                <p className="caixa-modal-erro" role="alert">
                  {erroModal}
                </p>
              ) : null}
              <div className="caixa-modal-campo-cliente">
                <label htmlFor="caixa-modal-cliente" className="caixa-modal-campo-cliente-label">
                  Cliente (obrigatório)
                </label>
                <select
                  id="caixa-modal-cliente"
                  name="cliente"
                  className="caixa-modal-select-cliente"
                  value={clienteUserId === null ? '' : String(clienteUserId)}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '') {
                      setClienteUserId(null)
                      return
                    }
                    const n = Number.parseInt(v, 10)
                    setClienteUserId(Number.isInteger(n) && n > 0 ? n : null)
                  }}
                  disabled={finalizando || userIdLogado === null}
                  aria-busy={clientesCarregando}
                  required
                >
                  <option value="">— Selecione o cliente —</option>
                  {clientesLista.map((c) => (
                    <option key={c.user_id} value={c.user_id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
                {clientesCarregando ? (
                  <p className="caixa-modal-cliente-hint">A carregar clientes…</p>
                ) : clientesLista.length === 0 && userIdLogado !== null ? (
                  <p className="caixa-modal-cliente-hint">
                    Nenhum utilizador com perfil cliente encontrado. Cadastre clientes em
                    Utilizadores.
                  </p>
                ) : userIdLogado !== null && !clientesCarregando && clientesLista.length > 0 ? (
                  <p className="caixa-modal-cliente-hint">
                    A compra fica registada em nome do cliente selecionado.
                  </p>
                ) : null}
              </div>
              <div className="caixa-modal-tabela-wrap">
                <table className="caixa-modal-tabela">
                  <thead>
                    <tr>
                      <th scope="col">Produto</th>
                      <th scope="col" className="num">
                        Qtd
                      </th>
                      <th scope="col" className="num">
                        Preço un.
                      </th>
                      <th scope="col" className="num">
                        Subtotal
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasModal.map((l, idx) => {
                      const p = l.produto
                      const itemCalc = payloadModal.itens[idx]
                      const sub = itemCalc?.subtotal ?? 0
                      const precoUn = itemCalc?.unit_price ?? arredondarMoeda(p.price)
                      return (
                        <tr key={p.product_id}>
                          <td title={p.name}>{p.name}</td>
                          <td className="num caixa-modal-td-qtd">
                            <input
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              className="caixa-modal-qtd-input"
                              aria-label={`Quantidade para ${p.name}`}
                              value={
                                l.quantidadeVenda === 0
                                  ? ''
                                  : String(l.quantidadeVenda)
                              }
                              onFocus={(e) =>
                                focoQuantidadeLinha(
                                  p.product_id,
                                  l.quantidadeVenda,
                                  e.currentTarget,
                                )
                              }
                              onBlur={() => blurQuantidadeLinha(p.product_id)}
                              onChange={(e) =>
                                definirQuantidadeLinha(
                                  p.product_id,
                                  e.target.value,
                                )
                              }
                            />
                            <span className="caixa-modal-estoque-hint">
                              máx. {p.quantity}
                            </span>
                          </td>
                          <td className="num">
                            {formatarPrecoExibicao(precoUn)}
                          </td>
                          <td className="num">{formatarPrecoExibicao(sub)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="caixa-modal-total">
                Total: {formatarPrecoExibicao(totalModal)}
              </div>
            </div>
            <div className="caixa-modal-rodape">
              <button
                type="button"
                className="btn-modal-secundario"
                onClick={fecharModalResumo}
                disabled={finalizando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-modal-primario"
                disabled={confirmarDesabilitado}
                onClick={() => void confirmarVenda()}
              >
                {finalizando ? 'A registar…' : 'Confirmar venda'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
