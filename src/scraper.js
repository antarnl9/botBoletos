// Lee los precios reales de la página del evento usando ScrapingBee,
// que sí pasa la protección Cloudflare (la API pública de SeatGeek no
// expone los listados del Mundial).

const SCRAPINGBEE = 'https://app.scrapingbee.com/api/v1/';

export async function scrapeSeatGeek({ apiKey, url, stealth }) {
  const api = new URL(SCRAPINGBEE);
  api.searchParams.set('api_key', apiKey);
  api.searchParams.set('url', url);
  api.searchParams.set('render_js', 'true');
  // Para sitios con Cloudflare (SeatGeek) el proxy stealth es el que pasa.
  // OJO: stealth NO acepta block_resources / country_code / timeout (dan error 500),
  // por eso en stealth solo mandamos lo mínimo.
  if (stealth) {
    api.searchParams.set('stealth_proxy', 'true');
  } else {
    api.searchParams.set('premium_proxy', 'true');
    api.searchParams.set('block_resources', 'false');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 150000); // stealth + render tarda ~90s
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

// Los precios vienen embebidos como JSON en la página (Next.js __NEXT_DATA__ y
// datos schema.org), NO como texto con "$". Leemos esos campos directamente.
export function parseListings(html) {
  const vals = (key) => {
    const re = new RegExp('"' + key + '":\\s*([0-9]+(?:\\.[0-9]+)?)', 'g');
    const out = [];
    let m;
    while ((m = re.exec(html)) !== null) out.push(Number(m[1]));
    return out;
  };

  const lows = vals('lowest_price').filter((n) => n > 0);
  const highs = vals('highest_price').filter((n) => n > 0);
  const avgs = vals('average_price').filter((n) => n > 0);
  const counts = vals('listing_count');

  // Respaldo: datos estructurados schema.org (lowPrice / highPrice)
  const ldLow = vals('lowPrice').filter((n) => n > 0);
  const ldHigh = vals('highPrice').filter((n) => n > 0);

  const lowest = lows.length ? Math.min(...lows) : ldLow.length ? Math.min(...ldLow) : null;
  const highest = highs.length ? Math.max(...highs) : ldHigh.length ? Math.max(...ldHigh) : null;
  const average = avgs.length ? Math.round(avgs.sort((a, b) => a - b)[Math.floor(avgs.length / 2)]) : null;
  const listingCount = counts.length ? Math.max(...counts) : null;

  return { lowest, highest, average, listingCount, sampleCount: lows.length + ldLow.length };
}
