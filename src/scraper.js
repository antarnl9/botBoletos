// Lee los precios reales de la página de un evento usando ScrapingBee,
// que sí pasa la protección Cloudflare. Sirve para SeatGeek, Viagogo y StubHub.

const SCRAPINGBEE = 'https://app.scrapingbee.com/api/v1/';

export async function scrapePrices({ apiKey, url, stealth }) {
  const api = new URL(SCRAPINGBEE);
  api.searchParams.set('api_key', apiKey);
  api.searchParams.set('url', url);
  api.searchParams.set('render_js', 'true');
  // Cloudflare exige el proxy stealth. OJO: stealth NO acepta
  // block_resources / country_code / timeout (dan error 500).
  if (stealth) {
    api.searchParams.set('stealth_proxy', 'true');
  } else {
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
    const html = await res.text();
    return parseListings(html);
  } finally {
    clearTimeout(timer);
  }
}

// Auto-detecta el formato:
//  - SeatGeek: precios en campos JSON (lowest_price / listing_count).
//  - Viagogo / StubHub: JSON en 0, precios como texto "$X,XXX".
export function parseListings(html) {
  const nums = (key) => {
    const re = new RegExp('"' + key + '":\\s*([0-9]+(?:\\.[0-9]+)?)', 'g');
    const out = [];
    let m;
    while ((m = re.exec(html)) !== null) out.push(Number(m[1]));
    return out;
  };

  // --- Método 1: campos JSON (SeatGeek) ---
  const jLows = nums('lowest_price').filter((n) => n > 0);
  if (jLows.length) {
    const jHighs = nums('highest_price').filter((n) => n > 0);
    const jAvgs = nums('average_price').filter((n) => n > 0);
    const jCnts = nums('listing_count');
    return {
      lowest: Math.min(...jLows),
      highest: jHighs.length ? Math.max(...jHighs) : null,
      average: jAvgs.length ? Math.round(jAvgs[0]) : null,
      listingCount: jCnts.length ? Math.max(...jCnts) : null,
    };
  }

  // --- Método 2: montos con "$" en el texto (Viagogo / StubHub) ---
  const prices = [];
  const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d{3,6})(?:\.\d{2})?/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = Number(m[1].replace(/,/g, ''));
    if (n >= 100 && n <= 100000) prices.push(n);
  }
  const cm = html.match(/([\d,]{1,7})\s+(?:boletos|listados|tickets|listings?)\b/i);
  const listingCount = cm ? Number(cm[1].replace(/,/g, '')) : null;

  if (prices.length === 0) {
    return { lowest: null, highest: null, average: null, listingCount };
  }
  prices.sort((a, b) => a - b);
  return {
    lowest: prices[0],
    highest: prices[prices.length - 1],
    average: prices[Math.floor(prices.length / 2)],
    listingCount,
  };
}
