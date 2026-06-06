// ══════════════════════════════════════════════════════════════════════
// routes/pedidos.js — Compra de bilhetes
// ══════════════════════════════════════════════════════════════════════

const express        = require('express');
const authMiddleware = require('../middleware/auth');
const { queryOne, execute, transaction } = require('../db/database');
const { gerarCobranca } = require('../services/pix');

const router = express.Router();

// ── PÚBLICAS ────────────────────────────────────────────────────────────

// POST /api/pedidos — inicia uma compra
router.post('/', async (req, res) => {
  try {
    const { rifa_id, nome, telefone, quantidade } = req.body;

    // Validações
    if (!rifa_id || !nome || !telefone || !quantidade) {
      return res.status(400).json({ erro: 'Preencha todos os campos' });
    }
    if (quantidade < 1 || quantidade > 100) {
      return res.status(400).json({ erro: 'Quantidade deve ser entre 1 e 100' });
    }

    // Busca a rifa
    const rifa = await queryOne(
      'SELECT * FROM rifas WHERE id = $1 AND status = $2',
      [rifa_id, 'ativa']
    );
    if (!rifa) return res.status(404).json({ erro: 'Rifa não encontrada ou encerrada' });

    // Verifica se ainda tem bilhetes disponíveis (se tiver limite)
    if (rifa.meta_bilhetes) {
      const contagem = await queryOne(
        'SELECT COUNT(*) AS total FROM bilhetes WHERE rifa_id = $1',
        [rifa_id]
    );
      const total = parseInt(contagem?.total || 0);
      if (parseInt(total) + quantidade > rifa.meta_bilhetes) {
        return res.status(400).json({
          erro: `Só restam ${rifa.meta_bilhetes - parseInt(total)} bilhetes disponíveis`,
        });
      }
    }

    const valor_total = parseFloat(rifa.preco_bilhete) * quantidade;

    // Tudo em transação
    const resultado = await transaction(async (client) => {
      // 1. Cria o participante
      const { rows: [participante] } = await client.query(
        'INSERT INTO participantes (nome, telefone) VALUES ($1, $2) RETURNING *',
        [nome.trim(), telefone.trim()]
      );

      // 2. Gera cobrança PIX no EFI Bank
      const pix = await gerarCobranca({
        valor:     valor_total,
        nome:      nome.trim(),
        descricao: `${quantidade} bilhete(s) — ${rifa.titulo}`,
      });

      // 3. Cria o pedido com dados do PIX
      const { rows: [pedido] } = await client.query(`
        INSERT INTO pedidos
          (rifa_id, participante_id, quantidade, valor_total,
           pix_txid, pix_copiacola, pix_qrcode, pix_expira_em)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, quantidade, valor_total, status, pix_expira_em
      `, [
        rifa_id,
        participante.id,
        quantidade,
        valor_total,
        pix.txid,
        pix.copiaecola,
        pix.qrcode_imagem,
        pix.expira_em,
      ]);

      return { pedido, pix };
    });

    res.status(201).json({
      pedido_id:     resultado.pedido.id,
      valor_total:   resultado.pedido.valor_total,
      pix_expira_em: resultado.pedido.pix_expira_em,
      pix: {
        copiaecola:    resultado.pix.copiaecola,
        qrcode_imagem: resultado.pix.qrcode_imagem,
        valor:         valor_total.toFixed(2),
      },
    });

  } catch (err) {
    console.error('[pedidos/criar]', err);
    res.status(500).json({ erro: 'Erro ao processar pedido' });
  }
});

// GET /api/pedidos/:id/status — consulta status do pedido (polling do frontend)
router.get('/:id/status', async (req, res) => {
  try {
    const pedido = await queryOne(
      'SELECT id, status, pago_em, quantidade FROM pedidos WHERE id = $1',
      [req.params.id]
    );
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });

    res.json(pedido);
  } catch (err) {
    console.error('[pedidos/status]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── PROTEGIDAS (admin) ──────────────────────────────────────────────────

// PATCH /api/pedidos/:id/confirmar — confirmação manual pelo admin
router.patch('/:id/confirmar', authMiddleware, async (req, res) => {
  try {
    const pedido = await queryOne('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
    if (pedido.status === 'pago') return res.status(400).json({ erro: 'Pedido já está pago' });

    await _confirmarPedido(pedido.id, pedido.rifa_id, pedido.quantidade);

    res.json({ mensagem: 'Pedido confirmado manualmente' });
  } catch (err) {
    console.error('[pedidos/confirmar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PATCH /api/pedidos/:id/cancelar — cancela pedido
router.patch('/:id/cancelar', authMiddleware, async (req, res) => {
  try {
    const pedido = await queryOne('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
    if (pedido.status === 'pago') {
      return res.status(400).json({ erro: 'Pedido pago não pode ser cancelado aqui — faça estorno manual no EFI Bank' });
    }

    await execute(
      "UPDATE pedidos SET status = 'cancelado' WHERE id = $1",
      [pedido.id]
    );

    res.json({ mensagem: 'Pedido cancelado' });
  } catch (err) {
    console.error('[pedidos/cancelar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── HELPER INTERNO (usado pelo webhook e confirmação manual) ────────────
async function _confirmarPedido(pedido_id, rifa_id, quantidade) {
  await transaction(async (client) => {
    // 1. Marca pedido como pago
    await client.query(
      "UPDATE pedidos SET status = 'pago', pago_em = NOW() WHERE id = $1",
      [pedido_id]
    );

    // 2. Gera os bilhetes
    for (let i = 0; i < quantidade; i++) {
      await client.query(
        'INSERT INTO bilhetes (rifa_id, pedido_id) VALUES ($1, $2)',
        [rifa_id, pedido_id]
      );
    }
  });
}

module.exports = { router, _confirmarPedido };
