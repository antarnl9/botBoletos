import 'dotenv/config';

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== '' ? n : fallback;
}

function list(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  port: num(process.env.PORT, 3000),

  // --- SeatGeek ---
  seatgeekClientId: process.env.SEATGEEK_CLIENT_ID || '',
  // ID exacto del evento en SeatGeek (lo más confiable). Se saca de la URL del evento:
  // seatgeek.com/.../17650335  -> EVENT_ID=17650335
  // Default: Mexico vs England, Round of 16, World Cup 2026 (Estadio Banorte).
  // Si tiene valor, se ignora la búsqueda por texto de abajo.
  eventId: process.env.EVENT_ID || '17650335',
  // Texto de búsqueda que se manda a la API (parámetro q) — solo si NO hay EVENT_ID.
  eventQuery: process.env.EVENT_QUERY || 'mexico england',
  // Filtro extra del lado nuestro: el título del evento debe contener TODAS estas palabras.
  // Vacío = no filtrar. Default apunta a "Mexico vs England".
  titleContains: process.env.EVENT_TITLE_CONTAINS === undefined
    ? ['mexico', 'england']
    : list(process.env.EVENT_TITLE_CONTAINS),

  // --- Alertas ---
  // Precio (en la moneda que devuelve la API, normalmente USD) por debajo del cual quieres que te avise.
  // 0 = desactivado (solo se muestra el front, no se manda Telegram).
  priceThreshold: num(process.env.PRICE_THRESHOLD, 0),
  pollIntervalMinutes: num(process.env.POLL_INTERVAL_MINUTES, 2),
  currency: process.env.CURRENCY || 'USD',

  // --- Telegram ---
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
};

export const isDemoMode = !config.seatgeekClientId;
