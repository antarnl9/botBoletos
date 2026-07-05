import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config, isDemoMode } from './src/config.js';
import { fetchEvents } from './src/seatgeek.js';
import { scrapeSeatGeek } from './src/scraper.js';
import { sendTelegram } from './src/telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Estado en memoria (lo que el front consulta) ----
const state = {
  events: [],
  lastCheck: null,
  error: null,
  demoMode: isDemoMode,
  threshold: config.priceThreshold,
  currency: config.currency,
  pollIntervalMinutes: config.pollIntervalMinutes,
  source: 'api', // 'api' | 'scrape'
  scrapeError: null,
};

// Anti-spam: por evento guardamos el ultimo precio bajo que ya avisamos.
const alertState = new Map();

function fmtMoney(n) {
  if (n == null) return 's/d';
  return `${config.currency} $${Number(n).toLocaleString('en-US')}`;
}

function fmtVenue(v) {
  if (!v) return 'Lugar por confirmar';
  return [v.name, v.city, v.country].filter(Boolean).join(', ');
}

function fmtDate(iso) {
  if (!iso) return 'Fecha por confirmar';
  try {
    return new Date(iso).toLocaleString('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

async function maybeAlert(ev) {
  const low = ev.stats.lowest;
  if (!config.priceThreshold || low == null) return;

  const key = String(ev.id);
  const prev = alertState.get(key);

  if (low <= config.priceThreshold) {
    // Avisa la primera vez que baja del umbral, y de nuevo si marca un nuevo minimo.
    if (!prev || low < prev.lastAlertedLow) {
      const text =
        `🎟️ <b>¡Bajo el precio!</b>\n` +
        `<b>${ev.title}</b>\n` +
        `📍 ${fmtVenue(ev.venue)}\n` +
        `📅 ${fmtDate(ev.datetime)}\n` +
        `💰 Mas barato: <b>${fmtMoney(low)}</b> (umbral ${fmtMoney(config.priceThreshold)})\n` +
        `📊 Mediana ${fmtMoney(ev.stats.median)} · Mas alto ${fmtMoney(ev.stats.highest)} · ${ev.stats.listingCount} listados` +
        (ev.url ? `\n🔗 ${ev.url}` : '');

      await sendTelegram({ token: config.telegram.token, chatId: config.telegram.chatId, text });
      alertState.set(key, { lastAlertedLow: low });
      console.log(`[alert] Enviado para "${ev.title}" a ${fmtMoney(low)}`);
    }
  } else if (prev) {
    // Volvio a subir por encima del umbral: rearmamos para la proxima baja.
    alertState.delete(key);
  }
}

async function poll() {
  try {
    const events = await fetchEvents({
      clientId: config.seatgeekClientId,
      query: config.eventQuery,
      titleContains: config.titleContains,
      eventId: config.eventId,
    });

    // Los eventos del Mundial no traen precios por la API pública. Si hay
    // ScrapingBee configurado, leemos los precios reales de la página web.
    if (config.scrapingbee.apiKey && events.length) {
      state.source = 'scrape';
      for (const ev of events) {
        const target = config.eventUrl || ev.url;
        if (!target) continue;
        try {
          const s = await scrapeSeatGeek({
            apiKey: config.scrapingbee.apiKey,
            stealth: config.scrapingbee.stealth,
            url: target,
          });
          if (s.lowest != null) {
            ev.stats.lowest = s.lowest;
            ev.stats.highest = s.highest ?? ev.stats.highest;
            ev.stats.median = s.average ?? ev.stats.median;
          }
          if (s.listingCount != null) ev.stats.listingCount = s.listingCount;
          state.scrapeError = null;
          console.log(`[scrape] ${ev.title}: mas barato ${s.lowest}, ${s.listingCount} listados`);
        } catch (se) {
          state.scrapeError = se.message;
          console.error('[scrape] error:', se.message);
        }
      }
    } else {
      state.source = 'api';
    }

    state.events = events;
    state.lastCheck = new Date().toISOString();
    state.error = null;
    for (const ev of events) await maybeAlert(ev);
    console.log(`[poll] ${events.length} evento(s). fuente=${state.source} ${isDemoMode ? '(DEMO)' : ''}`);
  } catch (e) {
    state.error = e.message;
    console.error('[poll] error:', e.message);
  }
}

// ---- Servidor web ----
const app = express();

app.get('/api/prices', (_req, res) => res.json(state));
app.get('/api/health', (_req, res) => res.json({ ok: true, lastCheck: state.lastCheck }));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(config.port, () => {
  console.log(`🚀 Servidor en http://localhost:${config.port}`);
  console.log(`   Modo: ${isDemoMode ? 'DEMO (sin SEATGEEK_CLIENT_ID)' : 'API real'}`);
  console.log(config.eventId
    ? `   Evento por ID: ${config.eventId}`
    : `   Busqueda: "${config.eventQuery}"  filtro titulo: [${config.titleContains.join(', ') || '—'}]`);
  console.log(`   Umbral de aviso: ${config.priceThreshold ? fmtMoney(config.priceThreshold) : 'DESACTIVADO'}`);
  console.log(`   Revisa cada ${config.pollIntervalMinutes} min.`);
  if (config.scrapingbee.apiKey) {
    const perDay = Math.round((24 * 60) / config.pollIntervalMinutes);
    const credits = perDay * (config.scrapingbee.stealth ? 75 : 25);
    console.log(`   Scraping: ON (${config.scrapingbee.stealth ? 'stealth 75' : 'premium 25'} créditos/consulta)`);
    console.log(`   ⚠️  A cada ${config.pollIntervalMinutes} min gastarías ~${credits.toLocaleString()} créditos/día (free = 1,000).`);
  } else {
    console.log(`   Scraping: OFF (solo API oficial; el Mundial no traerá precios)`);
  }

  poll(); // primera revision inmediata
  setInterval(poll, config.pollIntervalMinutes * 60 * 1000);
});
