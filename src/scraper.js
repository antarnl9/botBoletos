// Lee los precios reales de la página de un evento usando ScrapingBee (pasa Cloudflare).
// Cada sitio expone los precios distinto, por eso el parser tiene "modos".

const SCRAPINGBEE = 'https://app.scrapingbee.com/api/v1/';

export async function scrapePrices({ apiKey, url, stealth, mode = 'auto', wait }) {
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
      throw new Error(`ScrapingBee ${res.status}: ${body.slice(0, 300)}`);
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
//  'dollarFreq' -> Ticombo: monto "$" más bajo que se REPITE (ignora filtros/basura sueltos)
//  'auto'       -> intenta json y si no, dollar
export function parseListings(html, mode = 'auto') {
  const FLOOR = 1000; // los boletos de este evento valen miles; ignora montos pequeños (fees/filtros)

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

  // --- dólar más bajo que se repite >=3 veces (Ticombo: ignora $200/$500 sueltos de filtros) ---
  if (mode === 'dollarFreq') {
    const freq = {};
    valid.forEach((p) => (freq[p] = (freq[p] || 0) + 1));
    const repeated = Object.keys(freq).map(Number).filter((p) => freq[p] >= 3).sort((a, b) => a - b);
    const lowest = repeated.length ? repeated[0] : valid.length ? Math.min(...valid) : null;
    return {
      lowest,
      highest: valid.length ? Math.max(...valid) : null,
      average: median(valid),
      listingCount: cnt,
    };
  }

  // --- dólar más bajo (Viagogo) ---
  if (!valid.length) return { lowest: null, highest: null, average: null, listingCount: cnt };
  return { lowest: Math.min(...valid), highest: Math.max(...valid), average: median(valid), listingCount: cnt };
}
