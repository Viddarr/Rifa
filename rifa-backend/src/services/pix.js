const path   = require('path');
const fs     = require('fs');
const EfiPay = require('sdk-node-apis-efi');

// Em produção usa base64 da variável de ambiente
// Em desenvolvimento usa o arquivo físico
let certificado;
if (process.env.EFI_CERTIFICADO_BASE64) {
  const tmpPath = '/tmp/efi-cert.p12';
  fs.writeFileSync(tmpPath, Buffer.from(process.env.EFI_CERTIFICADO_BASE64, 'base64'));
  certificado = tmpPath;
} else {
  certificado = path.join(__dirname, '..', '..', process.env.EFI_CERTIFICADO);
}

const efipay = new EfiPay({
  client_id:     process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  sandbox:       process.env.EFI_SANDBOX === 'true',
  certificate:   certificado,
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