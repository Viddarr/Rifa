// ══════════════════════════════════════════════════════════════════════
// routes/dashboard.js — Dados do painel admin
// ══════════════════════════════════════════════════════════════════════

const express        = require('express');
const authMiddleware = require('../middleware/auth');
const { query, queryOne } = require('../db/database');

const router = express.Router();

// GET /api/dashboard — resumo geral
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [resumo, rifasAtivas, ultimosPedidos] = await Promise.all([

      // Totais gerais — bilhetes e arrecadado calculados em subqueries
      // separadas para evitar fan-out do JOIN duplo (pedidos x bilhetes)
      queryOne(`
        SELECT
          COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'ativa')    AS rifas_ativas,
          COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'sorteada') AS rifas_sorteadas,

          (
            SELECT COUNT(*)
            FROM bilhetes b
            JOIN pedidos pd ON pd.id = b.pedido_id
            WHERE pd.status = 'pago'
          ) AS total_bilhetes,

          (
            SELECT COALESCE(SUM(valor_total), 0)
            FROM pedidos
            WHERE status = 'pago'
          ) AS total_arrecadado

        FROM rifas r
      `),

      // Rifas ativas com progresso — mesma estratégia: subqueries isoladas
      query(`
        SELECT
          r.id, r.titulo, r.preco_bilhete, r.meta_bilhetes,
          r.data_sorteio, r.status,

          (
            SELECT COUNT(*)
            FROM bilhetes b
            WHERE b.rifa_id = r.id
          ) AS bilhetes_vendidos,

          (
            SELECT COALESCE(SUM(valor_total), 0)
            FROM pedidos p
            WHERE p.rifa_id = r.id
              AND p.status = 'pago'
          ) AS arrecadado

        FROM rifas r
        WHERE r.status = 'ativa'
        ORDER BY r.criado_em DESC
      `),

      // Últimos 10 pedidos
      query(`
        SELECT
          pd.id, pd.quantidade, pd.valor_total, pd.status, pd.pago_em, pd.criado_em,
          pa.nome, pa.telefone,
          r.titulo AS rifa_titulo
        FROM pedidos       pd
        JOIN participantes pa ON pa.id = pd.participante_id
        JOIN rifas         r  ON r.id  = pd.rifa_id
        ORDER BY pd.criado_em DESC
        LIMIT 10
      `),

    ]);

    res.json({ resumo, rifasAtivas, ultimosPedidos });

  } catch (err) {
    console.error('[dashboard]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
