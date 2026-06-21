// ══════════════════════════════════════════════════════════════════════
// routes/roleta.js — Configuração e sorteio da roleta de prêmios
// ══════════════════════════════════════════════════════════════════════

const express        = require('express');
const authMiddleware = require('../middleware/auth');
const { query, queryOne, execute, transaction } = require('../db/database');

const router = express.Router();

// ── PÚBLICO: ver configuração + prêmios da roleta de uma rifa ──────────
router.get('/:rifaId', async (req, res) => {
  try {
    const config = await queryOne(
      'SELECT * FROM roleta_config WHERE rifa_id = $1',
      [req.params.rifaId]
    );
    const premios = await query(
      'SELECT id, nome, descricao, imagem_url FROM roleta_premios WHERE rifa_id = $1 AND ativo = true',
      [req.params.rifaId]
    );
    const marcos = await query(
      'SELECT quantidade_minima, premio_descricao FROM roleta_marcos_garantidos WHERE rifa_id = $1 ORDER BY quantidade_minima',
      [req.params.rifaId]
    );

    res.json({ config, premios, marcos });
  } catch (err) {
    console.error('[roleta/config]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── PÚBLICO: ver quantos giros um participante tem disponível ──────────
// identificado pelo telefone (já que não tem login de comprador)
router.get('/:rifaId/giros/:telefone', async (req, res) => {
  try {
    const participante = await queryOne(
      'SELECT * FROM participantes WHERE telefone = $1',
      [req.params.telefone]
    );
    if (!participante) return res.json({ disponiveis: 0 });

    const giros = await queryOne(
      'SELECT * FROM roleta_giros WHERE rifa_id = $1 AND participante_id = $2',
      [req.params.rifaId, participante.id]
    );

    const disponiveis = giros ? (giros.giros_ganhos - giros.giros_usados) : 0;
    res.json({ disponiveis: Math.max(0, disponiveis) });
  } catch (err) {
    console.error('[roleta/giros]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── PÚBLICO: girar a roleta (consome 1 giro, sorteia prêmio por peso) ──
router.post('/:rifaId/girar', async (req, res) => {
  try {
    const { telefone } = req.body;
    if (!telefone) return res.status(400).json({ erro: 'Telefone obrigatório' });

    const participante = await queryOne(
      'SELECT * FROM participantes WHERE telefone = $1',
      [telefone]
    );
    if (!participante) return res.status(404).json({ erro: 'Participante não encontrado' });

    const resultado = await transaction(async (client) => {
      // Verifica giros disponíveis com lock
      const { rows: [giros] } = await client.query(
        'SELECT * FROM roleta_giros WHERE rifa_id = $1 AND participante_id = $2 FOR UPDATE',
        [req.params.rifaId, participante.id]
      );

      if (!giros || giros.giros_ganhos - giros.giros_usados <= 0) {
        throw new Error('SEM_GIROS');
      }

      // Busca prêmios ativos com peso
      const { rows: premios } = await client.query(
        'SELECT * FROM roleta_premios WHERE rifa_id = $1 AND ativo = true AND (estoque IS NULL OR estoque > 0)',
        [req.params.rifaId]
      );
      if (premios.length === 0) throw new Error('SEM_PREMIOS');

      // Sorteio ponderado por probabilidade
      const totalPeso = premios.reduce((s, p) => s + parseFloat(p.probabilidade), 0);
      let sorteio = Math.random() * totalPeso;
      let premioGanho = premios[premios.length - 1];

      for (const p of premios) {
        sorteio -= parseFloat(p.probabilidade);
        if (sorteio <= 0) { premioGanho = p; break; }
      }

      // Consome o giro
      await client.query(
        'UPDATE roleta_giros SET giros_usados = giros_usados + 1 WHERE id = $1',
        [giros.id]
      );

      // Reduz estoque se aplicável
      if (premioGanho.estoque !== null) {
        await client.query(
          'UPDATE roleta_premios SET estoque = estoque - 1 WHERE id = $1',
          [premioGanho.id]
        );
      }

      // Registra resultado
      await client.query(
        `INSERT INTO roleta_resultados (rifa_id, participante_id, tipo, premio_nome)
         VALUES ($1, $2, 'giro', $3)`,
        [req.params.rifaId, participante.id, premioGanho.nome]
      );

      return premioGanho;
    });

    res.json({ premio: resultado });

  } catch (err) {
    if (err.message === 'SEM_GIROS')   return res.status(400).json({ erro: 'Você não tem giros disponíveis' });
    if (err.message === 'SEM_PREMIOS') return res.status(400).json({ erro: 'Nenhum prêmio configurado' });
    console.error('[roleta/girar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── ADMIN: configurar bilhetes_por_giro ─────────────────────────────────
router.put('/:rifaId/config', authMiddleware, async (req, res) => {
  try {
    const { bilhetes_por_giro, ativo } = req.body;

    const existente = await queryOne(
      'SELECT * FROM roleta_config WHERE rifa_id = $1',
      [req.params.rifaId]
    );

    let config;
    if (existente) {
      config = await queryOne(`
        UPDATE roleta_config SET
          bilhetes_por_giro = COALESCE($1, bilhetes_por_giro),
          ativo = COALESCE($2, ativo)
        WHERE rifa_id = $3
        RETURNING *
      `, [bilhetes_por_giro, ativo, req.params.rifaId]);
    } else {
      config = await queryOne(`
        INSERT INTO roleta_config (rifa_id, bilhetes_por_giro, ativo)
        VALUES ($1, $2, COALESCE($3, true))
        RETURNING *
      `, [req.params.rifaId, bilhetes_por_giro || 5, ativo]);
    }

    res.json(config);
  } catch (err) {
    console.error('[roleta/config-admin]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── ADMIN: adicionar prêmio à roleta ────────────────────────────────────
router.post('/:rifaId/premios', authMiddleware, async (req, res) => {
  try {
    const { nome, descricao, imagem_url, probabilidade, estoque } = req.body;
    if (!nome || probabilidade === undefined) {
      return res.status(400).json({ erro: 'Nome e probabilidade são obrigatórios' });
    }

    const premio = await queryOne(`
      INSERT INTO roleta_premios (rifa_id, nome, descricao, imagem_url, probabilidade, estoque)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [req.params.rifaId, nome, descricao, imagem_url, probabilidade, estoque || null]);

    res.status(201).json(premio);
  } catch (err) {
    console.error('[roleta/premio-criar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── ADMIN: listar prêmios (incluindo inativos) ──────────────────────────
router.get('/:rifaId/premios/admin', authMiddleware, async (req, res) => {
  try {
    const premios = await query(
      'SELECT * FROM roleta_premios WHERE rifa_id = $1 ORDER BY probabilidade DESC',
      [req.params.rifaId]
    );
    res.json(premios);
  } catch (err) {
    console.error('[roleta/premios-admin]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── ADMIN: remover prêmio ───────────────────────────────────────────────
router.delete('/premios/:premioId', authMiddleware, async (req, res) => {
  try {
    await execute('DELETE FROM roleta_premios WHERE id = $1', [req.params.premioId]);
    res.json({ mensagem: 'Prêmio removido' });
  } catch (err) {
    console.error('[roleta/premio-remover]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── ADMIN: adicionar marco garantido ────────────────────────────────────
router.post('/:rifaId/marcos', authMiddleware, async (req, res) => {
  try {
    const { quantidade_minima, premio_descricao } = req.body;
    if (!quantidade_minima || !premio_descricao) {
      return res.status(400).json({ erro: 'Quantidade e descrição são obrigatórios' });
    }

    const marco = await queryOne(`
      INSERT INTO roleta_marcos_garantidos (rifa_id, quantidade_minima, premio_descricao)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.params.rifaId, quantidade_minima, premio_descricao]);

    res.status(201).json(marco);
  } catch (err) {
    console.error('[roleta/marco-criar]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── ADMIN: remover marco garantido ──────────────────────────────────────
router.delete('/marcos/:marcoId', authMiddleware, async (req, res) => {
  try {
    await execute('DELETE FROM roleta_marcos_garantidos WHERE id = $1', [req.params.marcoId]);
    res.json({ mensagem: 'Marco removido' });
  } catch (err) {
    console.error('[roleta/marco-remover]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;