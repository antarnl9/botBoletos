const SG_BASE = 'https://api.seatgeek.com/2';

/**
 * Consulta eventos en SeatGeek y los devuelve normalizados.
 * Si no hay client_id, regresa datos de DEMO para que el front y las
 * alertas se puedan probar sin credenciales todavia.
 */
export async function fetchEvents({ clientId, query, titleContains, eventId }) {
  if (!clientId) {
    return mockEvents();
  }

  // Ruta preferida: pedir el evento directo por su ID (mucho más confiable
  // que la búsqueda por texto, que a veces no devuelve el partido correcto).
  if (eventId) {
    const url = new URL(`${SG_BASE}/events/${eventId}`);
    url.searchParams.set('client_id', clientId);
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`SeatGeek respondio ${res.status} para el ID ${eventId}: ${body.slice(0, 300)}`);
    }
    const ev = await res.json();
    return ev && ev.id ? [normalize(ev)] : [];
  }

  const url = new URL(`${SG_BASE}/events`);
  url.searchParams.set('q', query);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('per_page', '25');
  url.searchParams.set('sort', 'datetime_utc.asc');

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SeatGeek respondio ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  let events = (data.events || []).map(normalize);

  if (titleContains && titleContains.length) {
    events = events.filter((e) =>
      titleContains.every((word) => e.title.toLowerCase().includes(word))
    );
  }
  return events;
}

function normalize(e) {
  const v = e.venue || {};
  const s = e.stats || {};
  return {
    id: e.id,
    title: e.title || e.short_title || 'Evento',
    datetime: e.datetime_local || e.datetime_utc || null,
    venue: {
      name: v.name || null,
      city: v.city || null,
      state: v.state || null,
      country: v.country || null,
    },
    url: e.url || null,
    stats: {
      lowest: s.lowest_price ?? null,
      median: s.median_price ?? null,
      highest: s.highest_price ?? null,
      listingCount: s.listing_count ?? 0,
    },
  };
}

// Datos de prueba (modo demo, sin client_id). El "lowest" varia un poco
// entre llamadas para que puedas ver el front cambiar y probar alertas.
let demoTick = 0;
function mockEvents() {
  demoTick += 1;
  const wobble = [0, -15, -40, -10, 20][demoTick % 5];
  return [
    {
      id: 'demo-1',
      title: 'Mexico vs England (DEMO — sin API real)',
      datetime: '2026-07-11T18:00:00',
      venue: { name: 'MetLife Stadium', city: 'East Rutherford', state: 'NJ', country: 'US' },
      url: 'https://seatgeek.com',
      stats: {
        lowest: 320 + wobble,
        median: 540,
        highest: 1850,
        listingCount: 214,
      },
    },
    {
      id: 'demo-2',
      title: 'Mexico vs England (DEMO — otra fecha)',
      datetime: '2026-07-15T20:00:00',
      venue: { name: 'AT&T Stadium', city: 'Arlington', state: 'TX', country: 'US' },
      url: 'https://seatgeek.com',
      stats: {
        lowest: 410 + wobble,
        median: 690,
        highest: 2400,
        listingCount: 158,
      },
    },
  ];
}
