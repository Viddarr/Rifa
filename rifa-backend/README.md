# 🍀 Top Rifas — Backend

API REST para gerenciamento de rifas online com pagamento via PIX.

## Stack
- **Node.js** + Express
- **PostgreSQL**
- **EFI Bank** (PIX)
- **JWT** (autenticação admin)

---

## Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edite o .env com seus dados

# 3. Criar o banco (PostgreSQL deve estar instalado)
createdb rifasdb

# 4. Rodar em desenvolvimento
npm run dev
```

---

## Variáveis de Ambiente (.env)

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | String de conexão PostgreSQL |
| `JWT_SECRET` | Chave secreta para assinar tokens |
| `EFI_CLIENT_ID` | Client ID do EFI Bank |
| `EFI_CLIENT_SECRET` | Client Secret do EFI Bank |
| `EFI_SANDBOX` | `true` em dev, `false` em produção |
| `PIX_CHAVE` | Sua chave PIX cadastrada no EFI Bank |
| `FRONTEND_URL` | URL do frontend (CORS) |

---

## Rotas da API

### Auth
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` | Login do admin |
| POST | `/api/auth/trocar-senha` | Trocar senha (autenticado) |

### Rifas (público)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/rifas` | Lista rifas ativas |
| GET | `/api/rifas/:id` | Detalhe de uma rifa |
| GET | `/api/rifas/:id/resultado` | Resultado do sorteio |

### Rifas (admin)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/rifas/admin/todas` | Todas as rifas |
| POST | `/api/rifas` | Criar rifa |
| PUT | `/api/rifas/:id` | Editar rifa |
| PATCH | `/api/rifas/:id/encerrar` | Encerrar rifa |
| POST | `/api/rifas/:id/sortear` | Realizar sorteio |
| GET | `/api/rifas/:id/participantes` | Listar participantes |

### Pedidos
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/pedidos` | Iniciar compra (gera PIX) |
| GET | `/api/pedidos/:id/status` | Consultar status |
| PATCH | `/api/pedidos/:id/confirmar` | Confirmar manualmente (admin) |
| PATCH | `/api/pedidos/:id/cancelar` | Cancelar pedido (admin) |

### Webhook
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/webhook/pix` | Recebe notificação do EFI Bank |

### Dashboard
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/dashboard` | Resumo geral (admin) |

---

## Configurar Webhook no EFI Bank

1. Acesse o painel do EFI Bank → API → Webhooks
2. Cadastre a URL: `https://seu-dominio.com/api/webhook/pix`
3. Para testar localmente use ngrok:
   ```bash
   ngrok http 3001
   # Use a URL gerada: https://xxxx.ngrok.io/api/webhook/pix
   ```

---

## Deploy no Railway

```bash
# 1. Instale o CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Crie o projeto
railway init

# 4. Adicione PostgreSQL
# Painel Railway → + New → Database → PostgreSQL

# 5. Configure as variáveis de ambiente no painel Railway

# 6. Suba o projeto
railway up
```

---

## Trocar a senha do admin padrão

```bash
# Gera um novo hash bcrypt
node -e "const b=require('bcryptjs'); console.log(b.hashSync('sua_nova_senha', 10))"

# Cole o hash no banco via psql ou painel do Railway
UPDATE admins SET senha_hash = 'hash_gerado' WHERE email = 'admin@toprifas.com';
```
