import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config, isDemoMode } from './src/config.js';
import { fetchEvents } from './src/seatgeek.js';
import { scrapePrices } from './src/scraper.js';
import { sendTelegram } from './src/telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const state = {
  event: null, // { title, datetime, venue }
  sources: [], // [ { label, url, lowest, highest, average, listingCount, error } ]
  cheapest: null, // la fuente con el precio más bajo
  lastCheck: null,
  error: null,
  scrapeError: null,
  demoMode: isDemoMode,
  threshold: config.priceThreshold,
  currency: config.currency,
  pollIntervalMinutes: config.pollIntervalMinutes,
  inScrapeWindow: true,
};

let lastAlertedLow = null;

function fmtMoney(n) {
  if (n == null) return 's/d';
  return `${config.currency} $${Number(n).toLocaleString('en-US')}`;
}
function fmtVenue(v) {
  if (!v) return 'Lugar por confirmar';
  return [v.name, v.city, v.country].filter(Boolean).join(', ');
}

// ¿Estamos dentro de la ventana horaria para scrapear? (ahorra créditos)
function withinScrapeWindow() {
  const s = config.scrapeStartHour;
  const e = config.scrapeEndHour;
  if (s <= 0 && e >= 24) return true;
  const h = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: config.scrapeTz, hour: '2-digit', hour12: false }).format(new Date())
  );
  return s <= e ? h >= s && h < e : h >= s || h < e; // soporta ventanas que cruzan medianoche
}

async function maybeAlert() {
  const c = state.cheapest;
  const low = c ? c.lowest : null;
  if (!config.priceThreshold || low == null) return;

  if (low <= config.priceThreshold) {
    // Avisa la primera vez que baja del límite, y de nuevo si marca un nuevo mínimo.
    if (lastAlertedLow == null || low < lastAlertedLow) {
      const text =
        `🎟️ <b>¡Bajó de tu límite!</b>\n` +
        `<b>${state.event?.title || 'Evento'}</b>\n` +
        `📍 ${fmtVenue(state.event?.venue)}\n` +
        `💰 Más barato: <b>${fmtMoney(low)}</b> en <b>${c.label}</b> (límite ${fmtMoney(config.priceThreshold)})\n` +
        `🔗 ${c.url}`;
      await sendTelegram({ token: config.telegram.token, chatId: config.telegram.chatId, text });
      lastAlertedLow = low;
      console.log(`[alert] ${fmtMoney(low)} en ${c.label}`);
    }
  } else {
    lastAlertedLow = null; // volvió a subir: rearmamos para la próxima baja
  }
}

let polling = false;
async function poll() {
  if (polling) {
    console.log('[poll] la ronda anterior sigue corriendo; salto esta.');
    return;
  }
  polling = true;
  try {
    // 1) Metadata del evento (título / estadio / fecha) desde la API oficial (gratis)
    try {
      const evs = await fetchEvents({
        clientId: config.seatgeekClientId,
        query: config.eventQuery,
        titleContains: config.titleContains,
        eventId: config.eventId,
      });
      if (evs[0]) state.event = { title: evs[0].title, datetime: evs[0].datetime, venue: evs[0].venue };
    } catch (e) {
      console.error('[meta] error:', e.message);
    }

    // 2) Precios: scrapear cada fuente (si hay key y estamos en ventana horaria)
    const inWindow = withinScrapeWindow();
    state.inScrapeWindow = inWindow;

    if (config.scrapingbee.apiKey && inWindow) {
      const results = [];
      for (const src of config.sources) {
        const r = { label: src.label, url: src.url, lowest: null, highest: null, average: null, listingCount: null, error: null };
        try {
          Object.assign(r, await scrapePrices({ apiKey: config.scrapingbee.apiKey, stealth: config.scrapingbee.stealth, url: src.url }));
        } catch (e) {
          r.error = e.message;
        }
        results.push(r);
        console.log(`[scrape] ${src.label}: ${r.lowest ?? 'error'} (${r.listingCount ?? '?'} listados)`);
      }
      state.sources = results;
      state.scrapeError = results.length && results.every((r) => r.error) ? results[0].error : null;
    } else if (!config.scrapingbee.apiKey) {
      state.sources = config.sources.map((s) => ({ label: s.label, url: s.url, lowest: null, error: 'falta SCRAPINGBEE_API_KEY' }));
    }
    // Fuera de ventana: dejamos los últimos precios vistos (no gastamos créditos).

    // 3) El más barato entre las fuentes con precio
    const withPrice = state.sources.filter((s) => s.lowest != null);
    state.cheapest = withPrice.length ? withPrice.reduce((a, b) => (b.lowest < a.lowest ? b : a)) : null;

    state.lastCheck = new Date().toISOString();
    state.error = null;
    await maybeAlert();
    console.log(`[poll] ventana=${inWindow} · más barato=${state.cheapest ? state.cheapest.lowest + ' (' + state.cheapest.label + ')' : 's/d'}`);
  } catch (e) {
    state.error = e.message;
    console.error('[poll] error:', e.message);
  } finally {
    polling = false;
  }
}

const app = express();
app.get('/api/prices', (_req, res) => res.json(state));
app.get('/api/health', (_req, res) => res.json({ ok: true, lastCheck: state.lastCheck }));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(config.port, () => {
  console.log(`🚀 Servidor en http://localhost:${config.port}`);
  console.log(`   Fuentes: ${config.sources.map((s) => s.label).join(', ')}`);
  console.log(`   Umbral de aviso: ${config.priceThreshold ? fmtMoney(config.priceThreshold) : 'DESACTIVADO'}`);
  if (config.scrapingbee.apiKey) {
    const win = config.scrapeStartHour <= 0 && config.scrapeEndHour >= 24
      ? 'siempre'
      : `${config.scrapeStartHour}:00–${config.scrapeEndHour}:00 ${config.scrapeTz}`;
    const perPoll = config.sources.length * (config.scrapingbee.stealth ? 75 : 25);
    console.log(`   Scraping: ON · ventana ${win} · cada ${config.pollIntervalMinutes} min · ~${perPoll} créditos/ronda (${config.sources.length} fuentes)`);
  } else {
    console.log('   Scraping: OFF (falta SCRAPINGBEE_API_KEY)');
  }

  poll(); // primera revisión inmediata
  setInterval(poll, config.pollIntervalMinutes * 60 * 1000);
});
