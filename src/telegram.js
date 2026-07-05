/**
 * Manda un mensaje por Telegram. Si faltan token o chatId, no hace nada
 * (para que el bot siga funcionando aunque solo quieras el front).
 */
export async function sendTelegram({ token, chatId, text }) {
  if (!token || !chatId) {
    console.warn('[telegram] Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID; no se envia el aviso.');
    return { skipped: true };
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[telegram] Error ${res.status}: ${body.slice(0, 200)}`);
    return { ok: false };
  }
  return { ok: true };
}
