/**
 * @fileoverview Bloco do dashboard “Melhores clientes”: ranking por valor total no mês corrente.
 */

import './RankingClientesMes.css'

/** Uma linha do ranking (dados já agregados no pai). */
export type LinhaRankingClienteMes = {
  user_id: number
  nome: string
  vendasNoMes: number
  totalNoMes: number
}

type Props = {
  linhas: LinhaRankingClienteMes[]
  /** Texto do mês de referência (ex.: “abril de 2026”). */
  etiquetaMes: string
  formatBRL: (n: number) => string
  formatInt: (n: number) => string
}

/**
 * Tabela “Melhores clientes”: ranking por valor total de compras no mês corrente.
 */
export function RankingClientesMes({
  linhas,
  etiquetaMes,
  formatBRL,
  formatInt,
}: Props) {
  return (
    <section
      className="dashboard-card ranking-clientes-mes"
      aria-labelledby="melhores-clientes-titulo"
    >
      <h2 id="melhores-clientes-titulo" className="dashboard-card-titulo">
        Melhores clientes
      </h2>
      <p className="dashboard-card-sub ranking-clientes-mes__sub">
        Soma do faturamento das vendas do mês atual ({etiquetaMes}), por cliente.
      </p>
      {linhas.length === 0 ? (
        <p className="dashboard-vazio">
          Sem vendas com cliente identificado neste mês.
        </p>
      ) : (
        <table className="dashboard-tabela ranking-clientes-mes__tabela">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Cliente</th>
              <th scope="col" className="num">
                Vendas
              </th>
              <th scope="col" className="num">
                Total no mês
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((row, i) => (
              <tr key={row.user_id}>
                <td>{i + 1}</td>
                <td title={row.nome}>{row.nome}</td>
                <td className="num">{formatInt(row.vendasNoMes)}</td>
                <td className="num">{formatBRL(row.totalNoMes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
