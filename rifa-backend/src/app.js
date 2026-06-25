// ══════════════════════════════════════════════════════════════════════
// app.js — Servidor principal
// ══════════════════════════════════════════════════════════════════════

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const app = express();

// ── CORS ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    const permitidas = [
      'https://toprifas.vercel.app',
    ];
    const vercelPreview = origin && origin.endsWith('.vercel.app');
    const local = !origin || origin.includes('localhost') || origin.includes('127.0.0.1');

    if (local || vercelPreview || permitidas.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS bloqueado'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Body parser ────────────────────────────────────────────────────────
app.use(express.json());

app.set('trust proxy', 1);

// ── Rate limiting ──────────────────────────────────────────────────────
// Limita a 100 requisições por IP a cada 15 minutos (geral)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { erro: 'Muitas requisições. Tente novamente em alguns minutos.' },
}));

// Limite mais rigoroso na rota de compra — 10 pedidos por IP a cada 15 min
app.use('/api/pedidos', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { erro: 'Limite de compras atingido. Aguarde alguns minutos.' },
}));

// Limite no login — 10 tentativas por IP a cada 15 min
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { erro: 'Muitas tentativas de login. Aguarde alguns minutos.' },
}));

// ── Rotas ──────────────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/rifas',     require('./routes/rifas'));
app.use('/api/pedidos',   require('./routes/pedidos').router);
app.use('/api/webhook',   require('./routes/webhook'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/roleta', require('./routes/roleta'));

// ── Health check ───────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV });
});

// ── 404 ────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ erro: `Rota não encontrada: ${req.method} ${req.path}` });
});

// ── Error handler global ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[erro global]', err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ── Inicia o servidor ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor rodando na porta ${PORT}`);
  console.log(`   Ambiente : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Health   : http://localhost:${PORT}/health\n`);
});
