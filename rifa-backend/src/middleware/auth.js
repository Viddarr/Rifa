// ══════════════════════════════════════════════════════════════════════
// middleware/auth.js — Verifica JWT nas rotas protegidas
// ══════════════════════════════════════════════════════════════════════

const jwt = require('jsonwebtoken');

module.exports = function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token não fornecido' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;  // { id, email, nome }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Token expirado — faça login novamente' });
    }
    return res.status(401).json({ erro: 'Token inválido' });
  }
};
