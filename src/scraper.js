// Lee los precios reales de la página del evento usando ScrapingBee,
// que sí pasa la protección Cloudflare (la API pública de SeatGeek no
// expone los listados del Mundial).

const SCRAPINGBEE = 'https://app.scrapingbee.com/api/v1/';

export async function scrapeSeatGeek({ apiKey, url, stealth }) {
  const api = new URL(SCRAPINGBEE);
  api.searchParams.set('api_key', apiKey);
  api.searchParams.set('url', url);
  api.searchParams.set('render_js', 'true'); // ejecutar el JS de la página
  api.searchParams.set('block_resources', 'false'); // ScrapingBee lo pide para sitios que no cargan bien
  api.searchParams.set('wait', '8000'); // esperar 8s a que carguen los listados
  api.searchParams.set('country_code', 'us');
  // proxy para pasar Cloudflare: stealth (75 créditos) es más potente; premium (25) más barato
  if (stealth) api.searchParams.set('stealth_proxy', 'true');
  else api.searchParams.set('premium_proxy', 'true');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 70000);
  try {
    const res = await fetch(api, { signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ScrapingBee ${res.status}: ${body.slice(0, 200)}`);
    }
    const html = await res.text();
    return parseListings(html);
  } finally {
    clearTimeout(timer);
  }
}

// Extrae el precio más bajo, más alto, mediana aproximada y # de listados
// del HTML ya renderizado. Se basa en los montos con "$" visibles en la página.
export function parseListings(html) {
  // "167 listings"
  const cm = html.match(/([\d,]{1,7})\s+listings?\b/i);
  const listingCount = cm ? Number(cm[1].replace(/,/g, '')) : null;

  // Todos los precios con "$" (con coma tipo 3,298 o sin coma de 3-6 dígitos).
  // Se ignoran montos < 100 para no confundir cuotas/porcentajes.
  const prices = [];
  const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d{3,6})(?:\.\d{2})?/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = Number(m[1].replace(/,/g, ''));
    if (n >= 100 && n <= 100000) prices.push(n);
  }

  if (prices.length === 0) {
    return { lowest: null, highest: null, median: null, listingCount, sampleCount: 0 };
  }

  prices.sort((a, b) => a - b);
  return {
    lowest: prices[0],
    highest: prices[prices.length - 1],
    median: prices[Math.floor(prices.length / 2)],
    listingCount,
    sampleCount: prices.length,
  };
}
