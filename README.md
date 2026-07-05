# 🎟️ SeatGeek Price Bot

Bot que revisa cada X minutos el precio de un evento en SeatGeek (por defecto **Mexico vs England**), te **avisa por Telegram cuando el precio baja de un umbral**, y muestra un **front sencillo** con la lista de precios y el lugar.

Un solo servicio Node.js → se despliega directo en **Railway**.

---

## ⚡ Prueba rápida (local, sin credenciales)

Funciona en **modo demo** aunque no tengas nada configurado todavía:

```bash
npm install
npm start
```

Abre http://localhost:3000 y verás la lista con datos de prueba.

---

## 🔑 Paso 1 — client_id de SeatGeek

1. Entra a **https://seatgeek.com/account/develop** y registra una app.
2. Copia el **Client ID** (SeatGeek aprueba las cuentas manualmente; puede tardar días).
3. Ponlo en la variable `SEATGEEK_CLIENT_ID`.

> Mientras no tengas el client_id, el bot corre en modo demo. En cuanto lo pongas, usa datos reales sin cambiar nada más.

## 📲 Paso 2 — Bot de Telegram

1. En Telegram busca **@BotFather** → `/newbot` → copia el **token** en `TELEGRAM_BOT_TOKEN`.
2. Abre tu bot y mándale cualquier mensaje (ej. `hola`).
3. Consigue tu chat_id:
   ```bash
   npm run chatid
   ```
   Copia el número en `TELEGRAM_CHAT_ID`.

## 🎯 Paso 3 — Configura el aviso

En tu `.env` (copia de `.env.example`):

```
PRICE_THRESHOLD=350        # te avisa si el boleto más barato baja de esto (USD)
EVENT_QUERY=mexico england
POLL_INTERVAL_MINUTES=15
```

Corre `npm start`. Recibirás un mensaje de Telegram cuando el precio cruce el umbral (y otra vez si marca un nuevo mínimo). No hace spam: se rearma solo cuando el precio vuelve a subir.

---

## 🚂 Desplegar en Railway

1. Sube esta carpeta a un repo de GitHub.
2. En [railway.app](https://railway.app): **New Project → Deploy from GitHub repo** y elige el repo.
3. Railway detecta Node y corre `npm start` solo.
4. En la pestaña **Variables**, agrega:
   - `SEATGEEK_CLIENT_ID`, `EVENT_QUERY`, `EVENT_TITLE_CONTAINS`
   - `PRICE_THRESHOLD`, `POLL_INTERVAL_MINUTES`, `CURRENCY`
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   - (No pongas `PORT`; Railway lo inyecta solo.)
5. En **Settings → Networking → Generate Domain** para tener la URL pública del front.

Listo: el servicio queda corriendo 24/7 revisando precios y sirviendo el front.

---

## ⚠️ Notas

- La API pública de SeatGeek da **precio más bajo / mediana / más alto / # de listados** y el **venue** (estadio + ciudad). No expone el asiento sección-por-sección, así que "lugar" = el estadio/ciudad.
- Los precios vienen normalmente en **USD**.
- Si SeatGeek no aprueba tu cuenta, avísame y vemos una ruta alterna (scraper/servicio externo).

## Variables de entorno

| Variable | Qué hace | Default |
|---|---|---|
| `SEATGEEK_CLIENT_ID` | Credencial de la API. Vacío = modo demo | — |
| `EVENT_QUERY` | Búsqueda que se manda a SeatGeek | `mexico england` |
| `EVENT_TITLE_CONTAINS` | Filtra títulos que contengan estas palabras | `mexico,england` |
| `PRICE_THRESHOLD` | Avisa si el más barato baja de esto. 0 = no avisa | `0` |
| `POLL_INTERVAL_MINUTES` | Cada cuánto revisa | `15` |
| `CURRENCY` | Etiqueta de moneda para mostrar | `USD` |
| `TELEGRAM_BOT_TOKEN` | Token de @BotFather | — |
| `TELEGRAM_CHAT_ID` | A quién avisar (`npm run chatid`) | — |
