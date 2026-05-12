// ══════════════════════════════════════════════════════════════════════
// routes/auth.js — Login do admin
// ══════════════════════════════════════════════════════════════════════

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { queryOne } = require('../db/database');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ erro: 'Email e senha obrigatórios' });
    }

    // Busca o admin pelo email
    const admin = await queryOne(
      'SELECT * FROM admins WHERE email = $1',
      [email]
    );

    if (!admin) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }

    // Compara a senha com o hash
    const senhaCorreta = await bcrypt.compare(senha, admin.senha_hash);
    if (!senhaCorreta) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }

    // Gera o token JWT
    const token = jwt.sign(
      { id: admin.id, email: admin.email, nome: admin.nome },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || '8h' }
    );

    res.json({
      token,
      admin: { id: admin.id, nome: admin.nome, email: admin.email },
    });

  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/auth/trocar-senha  (protegida)
const authMiddleware = require('../middleware/auth');

router.post('/trocar-senha', authMiddleware, async (req, res) => {
  try {
    const { senha_atual, nova_senha } = req.body;

    if (!senha_atual || !nova_senha) {
      return res.status(400).json({ erro: 'Preencha todos os campos' });
    }
    if (nova_senha.length < 8) {
      return res.status(400).json({ erro: 'Nova senha deve ter ao menos 8 caracteres' });
    }

    const admin = await queryOne('SELECT * FROM admins WHERE id = $1', [req.admin.id]);

    const correta = await bcrypt.compare(senha_atual, admin.senha_hash);
    if (!correta) {
      return res.status(401).json({ erro: 'Senha atual incorreta' });
    }

    const novo_hash = await bcrypt.hash(nova_senha, 10);
    await queryOne(
      'UPDATE admins SET senha_hash = $1 WHERE id = $2',
      [novo_hash, req.admin.id]
    );

    res.json({ mensagem: 'Senha atualizada com sucesso' });

  } catch (err) {
    console.error('[auth/trocar-senha]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
