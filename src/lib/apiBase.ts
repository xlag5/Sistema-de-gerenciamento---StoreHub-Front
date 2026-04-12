/**
 * @fileoverview Base URL da API consumida pelo frontend.
 */

/**
 * Prefixo para `fetch`: em desenvolvimento usa o proxy Vite (`/api` → backend, evita CORS);
 * em produção aponta para o host da API.
 * @type {string}
 */
export const API_BASE = import.meta.env.DEV
  ? '/api'
  : 'http://localhost:3000'
