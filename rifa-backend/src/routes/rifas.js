// ══════════════════════════════════════════════════════════════════════
// routes/rifas.js — CRUD de rifas
// ══════════════════════════════════════════════════════════════════════

const express        = require('express');
const authMiddleware = require('../middleware/auth');
const { query, queryOne, execute, transaction } = require('../db/database');

const router = express.Router();

// ── PÚBLICAS ────────────────────────────────────────────────────────────

// GET /api/rifas — lista rifas ativas
router.get('/', async (req, res) => {
  try {
    const rifas = await query(`
      SELECT
        r.*,
        COUNT(b.id)                              AS total_bilhetes_vendidos,
        COALESCE(SUM(p.valor_total), 0)          AS total_arrecadado,
        json_agg(pr ORDER BY pr.posicao)
          FILTER (WHERE pr.id IS NOT NULL)       AS premios
      FROM rifas r
      LEFT JOIN pedidos  p  ON p.rifa_id  = r.id AND p.status = 'pago'
      LEFT JOIN bilhetes b  ON b.rifa_id  = r.id
      LEFT JOIN premios  pr ON pr.rifa_id = r.id
      WHERE r.status = 'ativa'
      GROUP BY r.id
      ORDER BY r.criado_em DESC
    `);

    res.json(rifas);
  } catch (err) {
    console.error('[rifas/listar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/rifas/:id — detalhe de uma rifa
router.get('/:id', async (req, res) => {
  try {
    const rifa = await queryOne(`
      SELECT
        r.*,
        COUNT(b.id)                              AS total_bilhetes_vendidos,
        COALESCE(SUM(p.valor_total), 0)          AS total_arrecadado
      FROM rifas r
      LEFT JOIN pedidos  p ON p.rifa_id = r.id AND p.status = 'pago'
      LEFT JOIN bilhetes b ON b.rifa_id = r.id
      WHERE r.id = $1
      GROUP BY r.id
    `, [req.params.id]);

    if (!rifa) return res.status(404).json({ erro: 'Rifa não encontrada' });

    // Busca prêmios separadamente com ORDER BY garantido
    const premios = await query(
      'SELECT * FROM premios WHERE rifa_id = $1 ORDER BY posicao ASC',
      [req.params.id]
    );

    res.json({ ...rifa, premios });
  } catch (err) {
    console.error('[rifas/detalhe]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/rifas/:id/resultado — resultado público do sorteio
router.get('/:id/resultado', async (req, res) => {
  try {
    const rifa = await queryOne(
      'SELECT * FROM rifas WHERE id = $1 AND status = $2',
      [req.params.id, 'sorteada']
    );
    if (!rifa) return res.status(404).json({ erro: 'Resultado não disponível' });

    const ganhador = await queryOne(
      'SELECT nome, telefone FROM participantes WHERE id = $1',
      [rifa.ganhador_id]
    );

    res.json({
      rifa_titulo: rifa.titulo,
      sorteio_em:  rifa.sorteio_em,
      ganhador: {
        nome:     ganhador.nome,
        telefone: ganhador.telefone.replace(/\d(?=\d{4})/g, '*'), // mascara
      },
    });
  } catch (err) {
    console.error('[rifas/resultado]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── PROTEGIDAS (admin) ──────────────────────────────────────────────────

// GET /api/rifas/admin/todas — todas as rifas para o painel
router.get('/admin/todas', authMiddleware, async (req, res) => {
  try {
    const rifas = await query(`
      SELECT r.*,
        COUNT(b.id)                    AS total_bilhetes_vendidos,
        COALESCE(SUM(p.valor_total),0) AS total_arrecadado
      FROM rifas r
      LEFT JOIN pedidos  p ON p.rifa_id = r.id AND p.status = 'pago'
      LEFT JOIN bilhetes b ON b.rifa_id = r.id
      GROUP BY r.id
      ORDER BY r.criado_em DESC
    `);
    res.json(rifas);
  } catch (err) {
    console.error('[rifas/admin]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/rifas — criar nova rifa
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      titulo, descricao, imagem_url,
      preco_bilhete, meta_bilhetes, meta_valor,
      data_sorteio, premios = [],
    } = req.body;

    if (!titulo || !preco_bilhete) {
      return res.status(400).json({ erro: 'Título e preço são obrigatórios' });
    }
    if (preco_bilhete <= 0) {
      return res.status(400).json({ erro: 'Preço deve ser maior que zero' });
    }

    const rifa = await transaction(async (client) => {
      // Cria a rifa
      const { rows: [novaRifa] } = await client.query(`
        INSERT INTO rifas
          (titulo, descricao, imagem_url, preco_bilhete, meta_bilhetes, meta_valor, data_sorteio)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [titulo, descricao, imagem_url, preco_bilhete, meta_bilhetes, meta_valor, data_sorteio]);

      // Insere os prêmios se existirem
      for (const p of premios) {
        await client.query(
          'INSERT INTO premios (rifa_id, posicao, descricao, imagem_url) VALUES ($1, $2, $3, $4)',
          [novaRifa.id, p.posicao, p.descricao, p.imagem_url]
        );
      }

      return novaRifa;
    });

    res.status(201).json(rifa);
  } catch (err) {
    console.error('[rifas/criar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PUT /api/rifas/:id — editar rifa (só se ainda não tiver vendas)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { titulo, descricao, imagem_url, data_sorteio, preco_bilhete, meta_bilhetes } = req.body;

    const rifa = await queryOne('SELECT * FROM rifas WHERE id = $1', [req.params.id]);
    if (!rifa) return res.status(404).json({ erro: 'Rifa não encontrada' });
    if (rifa.status !== 'ativa') return res.status(400).json({ erro: 'Só rifas ativas podem ser editadas' });

    // Se já tem vendas, avisa mas permite (decisão do admin)
    const vendas = await queryOne(
      "SELECT COUNT(*) AS total FROM pedidos WHERE rifa_id = $1 AND status = 'pago'",
      [req.params.id]
    );
    const temVendas = parseInt(vendas?.total || 0) > 0;

    const atualizada = await queryOne(`
      UPDATE rifas SET
        titulo        = COALESCE($1, titulo),
        descricao     = COALESCE($2, descricao),
        imagem_url    = COALESCE($3, imagem_url),
        data_sorteio  = COALESCE($4, data_sorteio),
        preco_bilhete = COALESCE($5, preco_bilhete),
        meta_bilhetes = COALESCE($6, meta_bilhetes)
      WHERE id = $7
      RETURNING *
    `, [titulo, descricao, imagem_url, data_sorteio, preco_bilhete, meta_bilhetes, req.params.id]);

    res.json({ ...atualizada, aviso: temVendas ? 'Esta rifa já possui vendas — alterar o preço não afeta pedidos já criados.' : null });
  } catch (err) {
    console.error('[rifas/editar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PATCH /api/rifas/:id/encerrar — encerra a rifa manualmente
router.patch('/:id/encerrar', authMiddleware, async (req, res) => {
  try {
    const rifa = await queryOne('SELECT * FROM rifas WHERE id = $1', [req.params.id]);
    if (!rifa) return res.status(404).json({ erro: 'Rifa não encontrada' });
    if (rifa.status !== 'ativa') return res.status(400).json({ erro: 'Rifa não está ativa' });

    await execute(
      "UPDATE rifas SET status = 'encerrada' WHERE id = $1",
      [req.params.id]
    );

    res.json({ mensagem: 'Rifa encerrada' });
  } catch (err) {
    console.error('[rifas/encerrar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/rifas/:id/sortear — realiza o sorteio
router.post('/:id/sortear', authMiddleware, async (req, res) => {
  try {
    const rifa = await queryOne('SELECT * FROM rifas WHERE id = $1', [req.params.id]);
    if (!rifa) return res.status(404).json({ erro: 'Rifa não encontrada' });
    if (rifa.status === 'sorteada') return res.status(400).json({ erro: 'Sorteio já realizado' });
    if (!['ativa', 'encerrada'].includes(rifa.status)) {
      return res.status(400).json({ erro: 'Rifa não pode ser sorteada' });
    }

    // Sorteia um bilhete aleatório entre os pagos
    const ganhador = await queryOne(`
      SELECT b.id AS bilhete_id, p.id AS participante_id, p.nome, p.telefone
      FROM bilhetes b
      JOIN pedidos       pd ON pd.id = b.pedido_id
      JOIN participantes p  ON p.id  = pd.participante_id
      WHERE b.rifa_id = $1
      ORDER BY RANDOM()
      LIMIT 1
    `, [req.params.id]);

    if (!ganhador) {
      return res.status(400).json({ erro: 'Nenhum bilhete pago para sortear' });
    }

    // Registra o ganhador
    await execute(`
      UPDATE rifas
      SET status = 'sorteada', ganhador_id = $1, sorteio_em = NOW()
      WHERE id = $2
    `, [ganhador.participante_id, req.params.id]);

    res.json({
      mensagem:    'Sorteio realizado!',
      bilhete_id:  ganhador.bilhete_id,
      ganhador: {
        nome:     ganhador.nome,
        telefone: ganhador.telefone,
      },
    });
  } catch (err) {
    console.error('[rifas/sortear]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/rifas/:id/participantes — lista participantes (admin)
router.get('/:id/participantes', authMiddleware, async (req, res) => {
  try {
    const participantes = await query(`
      SELECT
        p.nome, p.telefone,
        pd.quantidade, pd.valor_total,
        pd.status, pd.pago_em, pd.criado_em
      FROM pedidos       pd
      JOIN participantes p ON p.id = pd.participante_id
      WHERE pd.rifa_id = $1
      ORDER BY pd.criado_em DESC
    `, [req.params.id]);

    res.json(participantes);
  } catch (err) {
    console.error('[rifas/participantes]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// DELETE /api/rifas/:id — exclui permanentemente uma rifa (só se não tiver pedidos)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const rifa = await queryOne('SELECT * FROM rifas WHERE id = $1', [req.params.id]);
    if (!rifa) return res.status(404).json({ erro: 'Rifa não encontrada' });

    const pedidos = await queryOne(
      'SELECT COUNT(*) AS total FROM pedidos WHERE rifa_id = $1',
      [req.params.id]
    );

    if (parseInt(pedidos?.total || 0) > 0) {
      return res.status(400).json({
        erro: 'Esta rifa já possui pedidos registrados e não pode ser excluída. Use "Pausar" ou "Encerrar" em vez disso.',
      });
    }

    await execute('DELETE FROM rifas WHERE id = $1', [req.params.id]);
    res.json({ mensagem: 'Rifa excluída com sucesso' });

  } catch (err) {
    console.error('[rifas/excluir]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PATCH /api/rifas/:id/pausar — desativa temporariamente (não aparece no site público)
router.patch('/:id/pausar', authMiddleware, async (req, res) => {
  try {
    const rifa = await queryOne('SELECT * FROM rifas WHERE id = $1', [req.params.id]);
    if (!rifa) return res.status(404).json({ erro: 'Rifa não encontrada' });
    if (rifa.status !== 'ativa') return res.status(400).json({ erro: 'Só rifas ativas podem ser pausadas' });

    await execute("UPDATE rifas SET status = 'pausada' WHERE id = $1", [req.params.id]);
    res.json({ mensagem: 'Rifa pausada' });
  } catch (err) {
    console.error('[rifas/pausar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PATCH /api/rifas/:id/reativar — volta a rifa pausada para ativa
router.patch('/:id/reativar', authMiddleware, async (req, res) => {
  try {
    const rifa = await queryOne('SELECT * FROM rifas WHERE id = $1', [req.params.id]);
    if (!rifa) return res.status(404).json({ erro: 'Rifa não encontrada' });
    if (rifa.status !== 'pausada') return res.status(400).json({ erro: 'Só rifas pausadas podem ser reativadas' });

    await execute("UPDATE rifas SET status = 'ativa' WHERE id = $1", [req.params.id]);
    res.json({ mensagem: 'Rifa reativada' });
  } catch (err) {
    console.error('[rifas/reativar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
