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

      // Totais gerais
      queryOne(`
        SELECT
          COUNT(DISTINCT r.id)  FILTER (WHERE r.status = 'ativa')    AS rifas_ativas,
          COUNT(DISTINCT r.id)  FILTER (WHERE r.status = 'sorteada') AS rifas_sorteadas,
          COUNT(b.id)                                                 AS total_bilhetes,
          COALESCE(SUM(p.valor_total) FILTER (WHERE p.status='pago'), 0) AS total_arrecadado
        FROM rifas r
        LEFT JOIN pedidos  p ON p.rifa_id = r.id
        LEFT JOIN bilhetes b ON b.rifa_id = r.id AND b.pedido_id IN (
          SELECT id FROM pedidos WHERE status = 'pago'
        )
      `),

      // Rifas ativas com progresso
      query(`
        SELECT
          r.id, r.titulo, r.preco_bilhete, r.meta_bilhetes,
          r.data_sorteio, r.status,
          COUNT(b.id)                            AS bilhetes_vendidos,
          COALESCE(SUM(p.valor_total), 0)        AS arrecadado
        FROM rifas r
        LEFT JOIN pedidos  p ON p.rifa_id = r.id AND p.status = 'pago'
        LEFT JOIN bilhetes b ON b.rifa_id = r.id
        WHERE r.status = 'ativa'
        GROUP BY r.id
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
