import 'dotenv/config';

// Ayudante: imprime tu chat_id de Telegram.
// 1) Crea el bot con @BotFather y copia el token en TELEGRAM_BOT_TOKEN (.env)
// 2) Abre tu bot en Telegram y mandale cualquier mensaje (ej. "hola")
// 3) Corre:  npm run chatid

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('❌ Falta TELEGRAM_BOT_TOKEN en tu .env');
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const data = await res.json();

if (!data.ok) {
  console.error('❌ Telegram respondio con error:', data);
  process.exit(1);
}

const chats = new Map();
for (const u of data.result || []) {
  const chat = u.message?.chat || u.channel_post?.chat;
  if (chat) chats.set(chat.id, chat);
}

if (chats.size === 0) {
  console.log('⚠️  No hay mensajes todavia. Mandale un mensaje a tu bot en Telegram y vuelve a correr esto.');
  process.exit(0);
}

console.log('✅ Chats encontrados (usa el id en TELEGRAM_CHAT_ID):\n');
for (const [id, chat] of chats) {
  const who = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '';
  console.log(`   chat_id = ${id}   (${chat.type}${who ? ' · ' + who : ''})`);
}
