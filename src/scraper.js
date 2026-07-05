// Lee los precios reales de la página de un evento usando ScrapingBee (pasa Cloudflare).
// Cada sitio expone los precios distinto, por eso el parser tiene "modos".

const SCRAPINGBEE = 'https://app.scrapingbee.com/api/v1/';

// Reintenta en errores transitorios (500/timeout). ScrapingBee no cobra los fallos.
export async function scrapePrices({ apiKey, url, stealth, mode = 'auto', wait, retries = 2 }) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await doScrape({ apiKey, url, stealth, wait, mode });
    } catch (e) {
      lastErr = e;
      // Reintenta solo fallos RÁPIDOS (5xx). En timeouts no reintenta (alargaría demasiado);
      // el "conservar último precio" + la siguiente ronda cubren ese caso.
      const transient = /\b(500|502|503|504)\b/.test(e.message);
      if (attempt < retries && transient) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function doScrape({ apiKey, url, stealth, wait, mode }) {
  const api = new URL(SCRAPINGBEE);
  api.searchParams.set('api_key', apiKey);
  api.searchParams.set('url', url);
  api.searchParams.set('render_js', 'true');
  if (wait) api.searchParams.set('wait', String(wait));
  // Cloudflare exige stealth. OJO: stealth NO acepta block_resources/country_code/timeout (dan 500).
  if (stealth) api.searchParams.set('stealth_proxy', 'true');
  else {
    api.searchParams.set('premium_proxy', 'true');
    api.searchParams.set('block_resources', 'false');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 150000);
  try {
    const res = await fetch(api, { signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ScrapingBee ${res.status}: ${body.slice(0, 200)}`);
    }
    return parseListings(await res.text(), mode);
  } finally {
    clearTimeout(timer);
  }
}

const median = (arr) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)] : null);

// modos:
//  'json'       -> SeatGeek: precios en campos JSON (lowest_price / listing_count)
//  'dollar'     -> Viagogo: monto "$" más bajo (>= FLOOR)
//  'dollarFreq' -> Ticombo: monto "$" real más bajo (aparece >=2 veces y NO es preset redondo de filtro)
//  'auto'       -> intenta json y si no, dollar
export function parseListings(html, mode = 'auto') {
  const FLOOR = 1000; // los boletos valen miles; ignora montos pequeños (fees/filtros)

  const jsonNums = (key) => {
    const re = new RegExp('"' + key + '":\\s*([0-9]+(?:\\.[0-9]+)?)', 'g');
    const out = [];
    let m;
    while ((m = re.exec(html)) !== null) out.push(Number(m[1]));
    return out;
  };

  const dollarAmounts = () => {
    const out = [];
    const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d{3,6})(?:\.\d{2})?/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const n = Number(m[1].replace(/,/g, ''));
      if (n >= 100 && n <= 100000) out.push(n);
    }
    return out;
  };

  const listingCount = () => {
    const cm = html.match(/([\d,]{1,7})\s+(?:boletos|listados|tickets|listings?|sellers)\b/i);
    return cm ? Number(cm[1].replace(/,/g, '')) : null;
  };

  // --- JSON (SeatGeek) ---
  if (mode === 'json' || mode === 'auto') {
    const lows = jsonNums('lowest_price').filter((n) => n > 0);
    if (lows.length) {
      const highs = jsonNums('highest_price').filter((n) => n > 0);
      const avgs = jsonNums('average_price').filter((n) => n > 0);
      const cnts = jsonNums('listing_count');
      return {
        lowest: Math.min(...lows),
        highest: highs.length ? Math.max(...highs) : null,
        average: avgs.length ? Math.round(avgs[0]) : null,
        listingCount: cnts.length ? Math.max(...cnts) : null,
      };
    }
    if (mode === 'json') return { lowest: null, highest: null, average: null, listingCount: listingCount() };
  }

  const prices = dollarAmounts();
  const cnt = listingCount();
  const valid = prices.filter((p) => p >= FLOOR);

  // --- Ticombo: el precio real más bajo, ignorando presets de filtro (redondos, múltiplos de 250) ---
  if (mode === 'dollarFreq') {
    const freq = {};
    valid.forEach((p) => (freq[p] = (freq[p] || 0) + 1));
    // reales = aparecen >=2 veces y NO son múltiplos de 250 (los filtros son $2,500 / $3,000 / etc.)
    const real = Object.keys(freq)
      .map(Number)
      .filter((p) => freq[p] >= 2 && p % 250 !== 0)
      .sort((a, b) => a - b);
    const nonRound = valid.filter((p) => p % 250 !== 0);
    const lowest = real.length ? real[0] : nonRound.length ? Math.min(...nonRound) : null;
    return {
      lowest,
      highest: valid.length ? Math.max(...valid) : null,
      average: median(nonRound.length ? nonRound : valid),
      listingCount: cnt,
    };
  }

  // --- Viagogo: dólar más bajo ---
  if (!valid.length) return { lowest: null, highest: null, average: null, listingCount: cnt };
  return { lowest: Math.min(...valid), highest: Math.max(...valid), average: median(valid), listingCount: cnt };
}
