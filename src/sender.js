export async function sendMessage(sock, to, type, payload) {
  switch (type) {
    case 'text':
      return sock.sendMessage(to, { text: payload.text });

    case 'image':
      return sock.sendMessage(to, {
        image: { url: payload.url },
        caption: payload.caption ?? '',
      });

    case 'audio':
      return sock.sendMessage(to, {
        audio: { url: payload.url },
        mimetype: 'audio/mpeg',
        ptt: payload.ptt ?? false,
      });

    case 'document':
      return sock.sendMessage(to, {
        document: { url: payload.url },
        mimetype: payload.mimetype ?? 'application/octet-stream',
        fileName: payload.filename ?? 'archivo',
      });

    default:
      throw new Error(`Tipo de mensaje no soportado: ${type}`);
  }
}
