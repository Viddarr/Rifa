// PIX simulado para desenvolvimento
// Substitua pelo SDK real quando for para produção

async function gerarCobranca({ valor, nome, descricao }) {
  const txid = 'dev-' + Date.now();
  return {
    txid,
    copiaecola:    '00020126580014br.gov.bcb.pix0136simulado',
    qrcode_imagem: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    expira_em:     new Date(Date.now() + 3600000),
  };
}

async function consultarCobranca(txid) {
  return { txid, status: 'ATIVA' };
}

module.exports = { gerarCobranca, consultarCobranca };