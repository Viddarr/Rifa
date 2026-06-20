// ══════════════════════════════════════════════════════════════════════
// routes/webhook.js — Recebe notificações do EFI Bank
// ══════════════════════════════════════════════════════════════════════

const express  = require('express');
const { queryOne, execute } = require('../db/database');
const { _confirmarPedido }  = require('./pedidos');

const router = express.Router();

router.post('/', (req, res) => {
  res.sendStatus(200);
});

// POST /api/webhook/pix
// O EFI Bank chama esta rota automaticamente quando um PIX é pago
router.post('/pix', async (req, res) => {
  // Responde 200 imediatamente — o EFI exige resposta rápida
  res.sendStatus(200);

  const { pix } = req.body;
  if (!pix || !Array.isArray(pix)) return;

  for (const pagamento of pix) {
    const { txid, valor } = pagamento;

    // Registra no log para auditoria
    try {
      await execute(
        'INSERT INTO webhooks_log (txid, payload) VALUES ($1, $2)',
        [txid, JSON.stringify(pagamento)]
      );
    } catch (_) { /* log não pode parar o fluxo */ }

    try {
      // Busca o pedido pelo txid
      const pedido = await queryOne(
        'SELECT * FROM pedidos WHERE pix_txid = $1',
        [txid]
      );

      if (!pedido) {
        console.warn(`[webhook] txid não encontrado: ${txid}`);
        continue;
      }

      if (pedido.status === 'pago') {
        console.log(`[webhook] txid já processado: ${txid}`);
        continue;
      }

      // Confirma o pedido e cria os bilhetes
      await _confirmarPedido(pedido.id, pedido.rifa_id, pedido.quantidade);

      // Marca no log como processado
      await execute(
        'UPDATE webhooks_log SET processado = TRUE WHERE txid = $1',
        [txid]
      );

      console.log(`✅ Pagamento confirmado: txid=${txid} valor=R$${valor}`);

    } catch (err) {
      console.error(`[webhook] Erro ao processar txid=${txid}:`, err.message);

      // Registra o erro no log
      await execute(
        'UPDATE webhooks_log SET erro = $1 WHERE txid = $2',
        [err.message, txid]
      ).catch(() => {});
    }
  }
});

// GET /api/webhook/pix — EFI Bank faz uma validação GET antes de ativar
router.get('/pix', (req, res) => {
  res.sendStatus(200);
});

module.exports = router;
