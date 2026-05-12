// ══════════════════════════════════════════════════════════════════════
// services/pix.js — Integração EFI Bank
// ══════════════════════════════════════════════════════════════════════

const EfiPay = require('sdk-node-apis-efi-bank');

const efipay = new EfiPay({
  client_id:     process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  sandbox:       process.env.EFI_SANDBOX === 'true',
});

/**
 * Gera uma cobrança PIX imediata
 * @param {Object} dados
 * @param {number} dados.valor       — valor em reais (ex: 29.90)
 * @param {string} dados.nome        — nome do pagador
 * @param {string} dados.descricao   — descrição da rifa
 * @returns {Object} { txid, copiaecola, qrcode_imagem, expira_em }
 */
async function gerarCobranca({ valor, nome, descricao }) {
  // 1. Cria a cobrança
  const body = {
    calendario: { expiracao: 3600 },        // expira em 1 hora
    devedor:    { nome },
    valor:      { original: valor.toFixed(2) },
    chave:      process.env.PIX_CHAVE,
    infoAdicionais: [{ nome: 'Descrição', valor: descricao }],
  };

  const cobranca = await efipay.pixCreateImmediateCharge({}, body);

  // 2. Gera o QR Code
  const qr = await efipay.pixGenerateQRCode({ id: cobranca.loc.id });

  const expira_em = new Date(Date.now() + 3600 * 1000);

  return {
    txid:          cobranca.txid,
    copiaecola:    qr.qrcode,
    qrcode_imagem: qr.imagemQrcode,   // base64 PNG
    expira_em,
  };
}

/**
 * Consulta o status de uma cobrança pelo txid
 */
async function consultarCobranca(txid) {
  return await efipay.pixDetailCharge({ txid });
}

module.exports = { gerarCobranca, consultarCobranca };
