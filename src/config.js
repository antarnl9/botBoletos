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

// SOURCES="SeatGeek|https://...;;Viagogo|https://..."  -> [{label,url},...]
function parseSources(value) {
  if (!value) return null;
  const out = value
    .split(';;')
    .map((part) => {
      const [label, url] = part.split('|').map((s) => s.trim());
      return label && url ? { label, url, mode: 'auto' } : null;
    })
    .filter(Boolean);
  return out.length ? out : null;
}

export const config = {
  port: num(process.env.PORT, 3000),

  // --- SeatGeek (solo para METADATA del evento: título, estadio, fecha) ---
  seatgeekClientId: process.env.SEATGEEK_CLIENT_ID || '',
  eventId: process.env.EVENT_ID || '17650335',
  eventQuery: process.env.EVENT_QUERY || 'mexico england',
  titleContains: process.env.EVENT_TITLE_CONTAINS === undefined
    ? ['mexico', 'england']
    : list(process.env.EVENT_TITLE_CONTAINS),

  // --- Fuentes de PRECIO a scrapear (una card por cada una) ---
  // Cada fuente = una consulta a ScrapingBee (75 créditos con stealth).
  sources: parseSources(process.env.SOURCES) ?? [
    {
      label: 'SeatGeek',
      url: 'https://seatgeek.com/fifa-world-cup-tickets/international-soccer/2026-07-05-6-pm/17650335',
      mode: 'json',
    },
    {
      label: 'Viagogo',
      url: 'https://www.viagogo.com.mx/Boletos-Deportes/Futbol/Soccer-Tournament/Copa-Mundial-de-Futbol-Boletos/E-153033507',
      mode: 'dollar',
      wait: 6000,
    },
    {
      // StubHub usa DataDome y no se puede scrapear; además comparte inventario con
      // Viagogo (misma empresa/mismo event id), así que refleja los datos de Viagogo.
      label: 'StubHub',
      url: 'https://www.stubhub.com/world-cup-ciudad-de-mexico-tickets-7-5-2026/event/153033507/',
      mirrorOf: 'Viagogo',
    },
    {
      label: 'Ticombo',
      url: 'https://www.ticombo.com/en/sports-tickets/football-tickets/match-92-r16-w79-vs-w80-football-world-cup-2026-2607052359/9eb3d927-c645-4c56-8d7a-3a9735956a03',
      mode: 'dollarFreq',
      wait: 8000,
    },
  ],

  // Tipo de cambio para normalizar a USD cuando un sitio devuelve MXN.
  // Si el "más barato" de una fuente sale > $20,000 se asume MXN y se divide entre esto.
  mxnPerUsd: num(process.env.MXN_PER_USD, 18),

  // --- Alertas ---
  priceThreshold: num(process.env.PRICE_THRESHOLD, 0),
  pollIntervalMinutes: num(process.env.POLL_INTERVAL_MINUTES, 2),
  currency: process.env.CURRENCY || 'USD',

  // --- Scraping (ScrapingBee) ---
  scrapingbee: {
    apiKey: process.env.SCRAPINGBEE_API_KEY || '',
    stealth: (process.env.SCRAPINGBEE_STEALTH || 'true').toLowerCase() === 'true',
  },
  // Ventana horaria para ahorrar créditos: fuera de estas horas NO se scrapea.
  scrapeStartHour: num(process.env.SCRAPE_START_HOUR, 0),
  scrapeEndHour: num(process.env.SCRAPE_END_HOUR, 24),
  scrapeTz: process.env.SCRAPE_TZ || 'America/Mexico_City',

  // --- Telegram ---
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
};

export const isDemoMode = !config.scrapingbee.apiKey;
