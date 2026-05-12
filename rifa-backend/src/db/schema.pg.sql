-- ══════════════════════════════════════════════════════════════════════
-- TOP RIFAS — Schema PostgreSQL
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admins (
  id         SERIAL      PRIMARY KEY,
  nome       TEXT        NOT NULL,
  email      TEXT        NOT NULL UNIQUE,
  senha_hash TEXT        NOT NULL,
  criado_em  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rifas (
  id             SERIAL        PRIMARY KEY,
  titulo         TEXT          NOT NULL,
  descricao      TEXT,
  imagem_url     TEXT,
  preco_bilhete  NUMERIC(10,2) NOT NULL,
  meta_bilhetes  INTEGER,
  meta_valor     NUMERIC(10,2),
  data_sorteio   DATE,
  status         TEXT          NOT NULL DEFAULT 'ativa'
                               CHECK (status IN ('ativa','encerrada','sorteada','cancelada')),
  ganhador_id    INTEGER,
  sorteio_em     TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS premios (
  id          SERIAL  PRIMARY KEY,
  rifa_id     INTEGER NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  posicao     INTEGER NOT NULL DEFAULT 1,
  descricao   TEXT    NOT NULL,
  imagem_url  TEXT
);

CREATE TABLE IF NOT EXISTS participantes (
  id        SERIAL      PRIMARY KEY,
  nome      TEXT        NOT NULL,
  telefone  TEXT        NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pedidos (
  id               SERIAL        PRIMARY KEY,
  rifa_id          INTEGER       NOT NULL REFERENCES rifas(id),
  participante_id  INTEGER       NOT NULL REFERENCES participantes(id),
  quantidade       INTEGER       NOT NULL CHECK (quantidade > 0),
  valor_total      NUMERIC(10,2) NOT NULL,
  status           TEXT          NOT NULL DEFAULT 'pendente'
                                 CHECK (status IN ('pendente','pago','expirado','cancelado')),
  pix_txid         TEXT          UNIQUE,
  pix_copiacola    TEXT,
  pix_qrcode       TEXT,
  pix_expira_em    TIMESTAMPTZ,
  pago_em          TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bilhetes (
  id        SERIAL      PRIMARY KEY,
  rifa_id   INTEGER     NOT NULL REFERENCES rifas(id),
  pedido_id INTEGER     NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhooks_log (
  id          SERIAL      PRIMARY KEY,
  txid        TEXT,
  payload     JSONB,
  processado  BOOLEAN     DEFAULT FALSE,
  erro        TEXT,
  recebido_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_rifa    ON pedidos(rifa_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_status  ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_txid    ON pedidos(pix_txid);
CREATE INDEX IF NOT EXISTS idx_bilhetes_rifa   ON bilhetes(rifa_id);
CREATE INDEX IF NOT EXISTS idx_bilhetes_pedido ON bilhetes(pedido_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_txid   ON webhooks_log(txid);

-- Admin inicial — senha padrão: admin123
-- TROQUE antes de ir pra produção:
--   node -e "const b=require('bcryptjs');console.log(b.hashSync('suasenha',10))"
INSERT INTO admins (nome, email, senha_hash)
VALUES (
  'Administrador',
  'admin@toprifas.com',
  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'
) ON CONFLICT (email) DO NOTHING;
