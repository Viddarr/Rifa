// ══════════════════════════════════════════════════════════════════════
// routes/bilhetes.js — Consulta pública de cotas por CPF
// ══════════════════════════════════════════════════════════════════════

const express   = require('express');
const { query } = require('../db/database');

const router = express.Router();

// GET /api/bilhetes/cpf/:cpf — lista as cotas pagas de um comprador pelo CPF
router.get('/cpf/:cpf', async (req, res) => {
  try {
    const cpfLimpo = req.params.cpf.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      return res.status(400).json({ erro: 'CPF inválido' });
    }

    const bilhetes = await query(`
      SELECT
        r.id       AS rifa_id,
        r.titulo   AS rifa_titulo,
        r.status   AS rifa_status,
        b.numero,
        pd.status  AS pedido_status,
        pd.criado_em
      FROM participantes part
      JOIN pedidos       pd ON pd.participante_id = part.id
      JOIN bilhetes      b  ON b.pedido_id = pd.id
      JOIN rifas         r  ON r.id = b.rifa_id
      WHERE part.cpf = $1
        AND pd.status = 'pago'
      ORDER BY r.criado_em DESC, b.numero ASC
    `, [cpfLimpo]);

    res.json({ bilhetes });
  } catch (err) {
    console.error('[bilhetes/cpf]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
