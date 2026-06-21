const path   = require('path');
const EfiPay = require('sdk-node-apis-efi');

const efipay = new EfiPay({
  client_id:     process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  sandbox:       process.env.EFI_SANDBOX === 'true',
  certificate:   path.join(__dirname, '..', '..', process.env.EFI_CERTIFICADO),
  cache:         false,
});

async function gerarCobranca({ valor, nome, cpf, descricao }) {
  const body = {
    calendario: { expiracao: 3600 },
    devedor:    { nome, cpf },
    valor:      { original: valor.toFixed(2) },
    chave:      process.env.PIX_CHAVE,
    infoAdicionais: [{ nome: 'Descricao', valor: descricao }],
  };

  const cobranca = await efipay.pixCreateImmediateCharge({}, body);
  const qr       = await efipay.pixGenerateQRCode({ id: cobranca.loc.id });

  return {
    txid:          cobranca.txid,
    copiaecola:    qr.qrcode,
    qrcode_imagem: qr.imagemQrcode,
    expira_em:     new Date(Date.now() + 3600000),
  };
}

async function consultarCobranca(txid) {
  return await efipay.pixDetailCharge({ txid });
}

module.exports = { gerarCobranca, consultarCobranca };