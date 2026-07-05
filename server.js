import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config, isDemoMode } from './src/config.js';
import { fetchEvents } from './src/seatgeek.js';
import { scrapePrices } from './src/scraper.js';
import { sendTelegram } from './src/telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const state = {
  event: null,
  sources: [],
  cheapest: null,
  lastCheck: null,
  error: null,
  scrapeError: null,
  demoMode: isDemoMode,
  threshold: config.priceThreshold,
  currency: config.currency,
  pollIntervalMinutes: config.pollIntervalMinutes,
  inScrapeWindow: true,
};

// Estado persistente por fuente: CONSERVA el último precio visto aunque un scrape
// falle o estemos fuera de ventana (así las cards no se "borran").
const sourceState = {};
for (const src of config.sources) {
  sourceState[src.label] = {
    label: src.label,
    url: src.url,
    mirrorOf: src.mirrorOf || null,
    note: src.mirrorOf ? `mismo inventario que ${src.mirrorOf}` : null,
    lowest: null,
    highest: null,
    average: null,
    listingCount: null,
    lastUpdated: null,
    error: null,
    stale: false,
  };
}

let lastAlertedLow = null;

function fmtMoney(n) {
  if (n == null) return 's/d';
  return `${config.currency} $${Number(n).toLocaleString('en-US')}`;
}
function fmtVenue(v) {
  if (!v) return 'Lugar por confirmar';
  return [v.name, v.city, v.country].filter(Boolean).join(', ');
}

function withinScrapeWindow() {
  const s = config.scrapeStartHour;
  const e = config.scrapeEndHour;
  if (s <= 0 && e >= 24) return true;
  const h = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: config.scrapeTz, hour: '2-digit', hour12: false }).format(new Date())
  );
  return s <= e ? h >= s && h < e : h >= s || h < e;
}

async function maybeAlert() {
  const c = state.cheapest;
  const low = c ? c.lowest : null;
  if (!config.priceThreshold || low == null) return;

  if (low <= config.priceThreshold) {
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
    lastAlertedLow = null;
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
    // 1) Metadata del evento (título/estadio/fecha) desde la API oficial (gratis)
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

    const inWindow = withinScrapeWindow();
    state.inScrapeWindow = inWindow;

    if (config.scrapingbee.apiKey && inWindow) {
      // 2) Scrapear fuentes reales (no mirror). Si falla, se CONSERVA el último precio.
      for (const src of config.sources) {
        if (src.mirrorOf) continue;
        const st = sourceState[src.label];
        try {
          const r = await scrapePrices({
            apiKey: config.scrapingbee.apiKey,
            stealth: config.scrapingbee.stealth,
            url: src.url,
            mode: src.mode,
            wait: src.wait,
          });
          if (r.lowest != null) {
            st.lowest = r.lowest;
            st.highest = r.highest;
            st.average = r.average;
            st.listingCount = r.listingCount;
            st.lastUpdated = new Date().toISOString();
            st.error = null;
            st.stale = false;
          } else {
            st.error = 'sin precio en esta lectura';
            st.stale = st.lowest != null; // conserva lo anterior
          }
        } catch (e) {
          st.error = e.message.slice(0, 120);
          st.stale = st.lowest != null; // conserva el último precio conocido
        }
        console.log(`[scrape] ${src.label}: ${st.lowest ?? 'null'} ${st.error ? '· ' + st.error.slice(0, 40) : ''}`);
      }

      // 3) Mirrors (StubHub): copian el resultado de su fuente origen (Viagogo)
      for (const src of config.sources) {
        if (!src.mirrorOf) continue;
        const st = sourceState[src.label];
        const from = sourceState[src.mirrorOf];
        if (from && from.lowest != null) {
          st.lowest = from.lowest;
          st.highest = from.highest;
          st.average = from.average;
          st.listingCount = from.listingCount;
          st.lastUpdated = from.lastUpdated;
          st.stale = from.stale;
          st.error = null;
        }
      }
      state.scrapeError = null;
    } else if (!config.scrapingbee.apiKey) {
      for (const src of config.sources) sourceState[src.label].error = 'falta SCRAPINGBEE_API_KEY';
    }
    // Fuera de ventana: no tocamos nada → las cards conservan el último precio.

    state.sources = config.sources.map((s) => ({ ...sourceState[s.label] }));

    // 4) Más barato entre las fuentes REALES (no mirror) con precio
    const real = state.sources.filter((s) => !s.mirrorOf && s.lowest != null);
    state.cheapest = real.length ? real.reduce((a, b) => (b.lowest < a.lowest ? b : a)) : null;

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
  console.log(`   Fuentes: ${config.sources.map((s) => s.label + (s.mirrorOf ? `(↔${s.mirrorOf})` : '')).join(', ')}`);
  console.log(`   Umbral de aviso: ${config.priceThreshold ? fmtMoney(config.priceThreshold) : 'DESACTIVADO'}`);
  if (config.scrapingbee.apiKey) {
    const win = config.scrapeStartHour <= 0 && config.scrapeEndHour >= 24
      ? 'siempre'
      : `${config.scrapeStartHour}:00–${config.scrapeEndHour}:00 ${config.scrapeTz}`;
    const realCount = config.sources.filter((s) => !s.mirrorOf).length;
    const perPoll = realCount * (config.scrapingbee.stealth ? 75 : 25);
    console.log(`   Scraping: ON · ventana ${win} · cada ${config.pollIntervalMinutes} min · ~${perPoll} créditos/ronda`);
  } else {
    console.log('   Scraping: OFF (falta SCRAPINGBEE_API_KEY)');
  }

  poll();
  setInterval(poll, config.pollIntervalMinutes * 60 * 1000);
});
