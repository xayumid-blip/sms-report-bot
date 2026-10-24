import express from 'express';
import cron from 'node-cron';
import fs from 'fs';

const {
  BOT_TOKEN,
  CHAT_IDS = '',
  SECRET,
  PORT = 3000,
  DATA_FILE = './data.json',
  ORG = 'Doctor Ali salomatlik markazi',
} = process.env;

if (!BOT_TOKEN || !SECRET || !CHAT_IDS) {
  console.error('BOT_TOKEN, SECRET va CHAT_IDS o\'zgaruvchilari kerak');
  process.exit(1);
}

const chats = CHAT_IDS.split(',').map((s) => s.trim()).filter(Boolean);
let tx = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : [];
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(tx));

const tg = (chat_id, text) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text }),
  }).catch((e) => console.error('Telegram xato:', e.message));

const broadcast = (text) => Promise.all(chats.map((c) => tg(c, text)));

const toNumber = (s) => {
  let v = s.replace(/\s/g, '');
  if (v.includes(',') && v.includes('.')) v = v.replace(/,/g, '');
  else if (v.includes(',')) v = v.replace(',', '.');
  return parseFloat(v);
};

// "Zachislenie QR: 6qz9..., 22.09.2026 v 11:43:21, 100.00 sum, ..."
function parse(sms) {
  const m = sms.match(
    /Zachislenie QR:\s*(\S+?),\s*(\d{2})\.(\d{2})\.(\d{4})\s+v\s+([\d:]+),\s*([\d\s.,]+?)\s*sum/i
  );
  if (!m) return null;
  const amount = toNumber(m[6]);
  if (Number.isNaN(amount)) return null;
  // QR identifikatori har safar bir xil bo'lishi mumkin (doimiy QR), shuning uchun
  // yagona kalit sifatida QR + sana + vaqt + summa ishlatiladi
  const date = `${m[4]}-${m[3]}-${m[2]}`;
  return { id: `${m[1]}|${date}T${m[5]}|${amount}`, date, amount };
}

const todayTashkent = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });

const fmt = (n) =>
  new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 2 }).format(n).replace(/\u00a0/g, ' ');

function buildReport() {
  const today = todayTashkent();
  const list = tx.filter((t) => t.date === today);
  if (!list.length) {
    return `${ORG}ga bugun QR-Code orqali kirim bo'lmadi.`;
  }
  const sum = list.reduce((a, t) => a + t.amount, 0);
  return `${ORG}ga bugun QR-Code orqali jami ${list.length} ta amaliyotdan ${fmt(sum)} so'm kirim bo'ldi.`;
}

const app = express();

// MacroDroid shu manzilga SMS matnini POST qiladi (Content-Type: text/plain)
app.post('/sms', express.text({ type: '*/*' }), async (req, res) => {
  if (req.query.key !== SECRET) return res.sendStatus(401);
  const sms = (req.body || '').toString().trim();
  if (!sms) return res.sendStatus(400);

  await broadcast(sms);

  const p = parse(sms);
  if (p && !tx.some((t) => t.id === p.id)) {
    tx.push(p);
    // 35 kundan eski yozuvlarni tozalash
    const cutoff = new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10);
    tx = tx.filter((t) => t.date >= cutoff);
    save();
  }
  res.send('ok');
});

// Qo'lda tekshirish: /report?key=SECRET
app.get('/report', async (req, res) => {
  if (req.query.key !== SECRET) return res.sendStatus(401);
  await broadcast(buildReport());
  res.send('yuborildi');
});

// Bot ishga tushishidan oldin kelgan SMS'ni qo'lda qo'shish (Telegram'ga qayta yubormaydi):
// /add?key=SECRET&text=SMS_MATNI
app.get('/add', (req, res) => {
  if (req.query.key !== SECRET) return res.sendStatus(401);
  const p = parse(String(req.query.text || ''));
  if (!p) return res.status(400).send('SMS formati tanilmadi');
  if (tx.some((t) => t.id === p.id)) return res.send('bu to\'lov avval qo\'shilgan');
  tx.push(p);
  save();
  res.send(`qo'shildi: ${p.date}, ${p.amount}`);
});

app.get('/', (_req, res) => res.send('ok'));

// Hisobot vaqtlari (Toshkent): 17:00 va 19:30
for (const expr of ['0 17 * * *', '30 19 * * *']) {
  cron.schedule(expr, () => broadcast(buildReport()), { timezone: 'Asia/Tashkent' });
}

app.listen(PORT, () => console.log(`Bot ${PORT} portda ishlayapti`));
