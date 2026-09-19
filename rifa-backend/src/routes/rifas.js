// ══════════════════════════════════════════════════════════════════════
// routes/rifas.js — CRUD de rifas
// ══════════════════════════════════════════════════════════════════════

const express        = require('express');
const authMiddleware = require('../middleware/auth');
const { query, queryOne, execute, transaction } = require('../db/database');

const router = express.Router();

// ── HELPER: mascara nome pra exibição pública (LGPD) ─────────────────────
function mascararNome(nomeCompleto) {
  if (!nomeCompleto) return null;
  const partes = nomeCompleto.trim().split(/\s+/);
  if (partes.length === 1) return partes[0];
  const primeiro = partes[0];
  const ultimaInicial = partes[partes.length - 1][0];
  return `${primeiro} ${ultimaInicial}.`;
}

// ── PÚBLICAS ────────────────────────────────────────────────────────────

// GET /api/rifas — lista rifas ativas
router.get('/', async (req, res) => {
  try {
    const rifas = await query(`
      SELECT
        r.*,

        (
          SELECT COUNT(*)
          FROM bilhetes b
          WHERE b.rifa_id = r.id
        ) AS total_bilhetes_vendidos,

        (
          SELECT COALESCE(SUM(valor_total), 0)
          FROM pedidos p
          WHERE p.rifa_id = r.id
            AND p.status = 'pago'
        ) AS total_arrecadado,

        json_agg(pr ORDER BY pr.posicao)
          FILTER (WHERE pr.id IS NOT NULL) AS premios

      FROM rifas r
      LEFT JOIN premios pr
        ON pr.rifa_id = r.id

      WHERE r.status = 'ativa'

      GROUP BY r.id
      ORDER BY r.criado_em DESC;
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

        (
          SELECT COUNT(*)
          FROM bilhetes b
          WHERE b.rifa_id = r.id
        ) AS total_bilhetes_vendidos,

        (
          SELECT COALESCE(SUM(valor_total), 0)
          FROM pedidos p
          WHERE p.rifa_id = r.id
            AND p.status = 'pago'
        ) AS total_arrecadado

      FROM rifas r
      WHERE r.id = $1;
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

// GET /api/rifas/:id/cotas-premiadas — lista pública das cotas premiadas
router.get('/:id/cotas-premiadas', async (req, res) => {
  try {
    const cotas = await query(
      `SELECT numero, descricao, revelado, comprador_nome, revelado_em
       FROM cotas_premiadas
       WHERE rifa_id = $1
       ORDER BY numero ASC`,
      [req.params.id]
    );

    // Só expõe o nome do ganhador (mascarado) quando a cota já foi revelada
    const resultado = cotas.map(c => ({
      numero:      c.numero,
      descricao:   c.descricao,
      revelado:    c.revelado,
      ganhador:    c.revelado ? mascararNome(c.comprador_nome) : null,
      revelado_em: c.revelado ? c.revelado_em : null,
    }));

    res.json(resultado);
  } catch (err) {
    console.error('[rifas/cotas-premiadas]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/rifas/:id/ranking — ranking público de compradores (se habilitado)
router.get('/:id/ranking', async (req, res) => {
  try {
    const rifa = await queryOne('SELECT ranking_ativo FROM rifas WHERE id = $1', [req.params.id]);
    if (!rifa) return res.status(404).json({ erro: 'Rifa não encontrada' });

    if (!rifa.ranking_ativo) {
      return res.json({ ativo: false, ranking: [] });
    }

    const ranking = await query(`
      SELECT p.nome, COUNT(b.id) AS total_cotas
      FROM bilhetes b
      JOIN pedidos pd       ON pd.id = b.pedido_id AND pd.status = 'pago'
      JOIN participantes p  ON p.id  = pd.participante_id
      WHERE b.rifa_id = $1
      GROUP BY p.id, p.nome
      ORDER BY total_cotas DESC
      LIMIT 20
    `, [req.params.id]);

    res.json({
      ativo: true,
      ranking: ranking.map((r, i) => ({
        posicao:      i + 1,
        nome:         mascararNome(r.nome),
        total_cotas:  parseInt(r.total_cotas),
      })),
    });
  } catch (err) {
    console.error('[rifas/ranking]', err);
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
      SELECT
        r.*,

        (
          SELECT COUNT(*)
          FROM bilhetes b
          WHERE b.rifa_id = r.id
        ) AS total_bilhetes_vendidos,

        (
          SELECT COALESCE(SUM(valor_total), 0)
          FROM pedidos p
          WHERE p.rifa_id = r.id
            AND p.status = 'pago'
        ) AS total_arrecadado

      FROM rifas r
      ORDER BY r.criado_em DESC;
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
      data_sorteio, premios = [], cotas_premiadas = [],
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

      // Insere as cotas premiadas se existirem
      // formato esperado: [{ numero, descricao }, ...]
      for (const c of cotas_premiadas) {
        await client.query(
          'INSERT INTO cotas_premiadas (rifa_id, numero, descricao) VALUES ($1, $2, $3)',
          [novaRifa.id, c.numero, c.descricao]
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

// PATCH /api/rifas/:id/ranking — liga/desliga o ranking público de compradores
router.patch('/:id/ranking', authMiddleware, async (req, res) => {
  try {
    const { ativo } = req.body;
    if (typeof ativo !== 'boolean') {
      return res.status(400).json({ erro: 'Campo "ativo" (boolean) é obrigatório' });
    }

    const atualizada = await queryOne(
      'UPDATE rifas SET ranking_ativo = $1 WHERE id = $2 RETURNING *',
      [ativo, req.params.id]
    );
    if (!atualizada) return res.status(404).json({ erro: 'Rifa não encontrada' });

    res.json(atualizada);
  } catch (err) {
    console.error('[rifas/ranking-toggle]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PUT /api/rifas/premios/:premioId — edita um prêmio existente (ex: adicionar/trocar foto)
router.put('/premios/:premioId', authMiddleware, async (req, res) => {
  try {
    const { descricao, imagem_url, posicao } = req.body;

    const atualizado = await queryOne(`
      UPDATE premios SET
        descricao  = COALESCE($1, descricao),
        imagem_url = COALESCE($2, imagem_url),
        posicao    = COALESCE($3, posicao)
      WHERE id = $4
      RETURNING *
    `, [descricao, imagem_url, posicao, req.params.premioId]);

    if (!atualizado) return res.status(404).json({ erro: 'Prêmio não encontrado' });
    res.json(atualizado);
  } catch (err) {
    console.error('[rifas/premio-editar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/rifas/:id/cotas-premiadas — adiciona cotas premiadas a uma rifa existente
router.post('/:id/cotas-premiadas', authMiddleware, async (req, res) => {
  try {
    const { numero, descricao } = req.body;
    if (numero === undefined || !descricao) {
      return res.status(400).json({ erro: 'Número e descrição são obrigatórios' });
    }

    const cota = await queryOne(
      'INSERT INTO cotas_premiadas (rifa_id, numero, descricao) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, numero, descricao]
    );

    res.status(201).json(cota);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ erro: 'Já existe uma cota premiada com esse número nesta rifa' });
    }
    console.error('[rifas/cota-premiada-criar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/rifas/:id/cotas-premiadas/admin — lista completa (com nome não mascarado) pro painel
router.get('/:id/cotas-premiadas/admin', authMiddleware, async (req, res) => {
  try {
    const cotas = await query(
      'SELECT * FROM cotas_premiadas WHERE rifa_id = $1 ORDER BY numero ASC',
      [req.params.id]
    );
    res.json(cotas);
  } catch (err) {
    console.error('[rifas/cotas-premiadas-admin]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// DELETE /api/rifas/cotas-premiadas/:cotaId — remove uma cota premiada
router.delete('/cotas-premiadas/:cotaId', authMiddleware, async (req, res) => {
  try {
    await execute('DELETE FROM cotas_premiadas WHERE id = $1', [req.params.cotaId]);
    res.json({ mensagem: 'Cota premiada removida' });
  } catch (err) {
    console.error('[rifas/cota-premiada-remover]', err);
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
      JOIN pedidos pd ON pd.id = b.pedido_id
      JOIN participantes p ON p.id = pd.participante_id
      WHERE b.rifa_id = $1
        AND pd.status = 'pago'
      ORDER BY RANDOM()
      LIMIT 1
    `, [req.params.id]);

    if (!ganhador) {
      return res.status(400).json({ erro: 'Nenhum bilhete pago para sortear' });
    }

    // Registra o ganhador (participante + bilhete exato sorteado)
    await execute(`
      UPDATE rifas
      SET status = 'sorteada', ganhador_id = $1, bilhete_ganhador_id = $2, sorteio_em = NOW()
      WHERE id = $3
    `, [ganhador.participante_id, ganhador.bilhete_id, req.params.id]);

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
