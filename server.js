const express = require('express');
const path = require('path');
const { randomInt } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PAIR_TTL_MS = 15 * 60 * 1000;
const pairs = new Map();

app.use(express.json({ limit: '8kb' }));
app.use(express.static(__dirname, { index: false }));

function cleanExpiredPairs() {
  const now = Date.now();
  for (const [code, pair] of pairs) if (pair.expiresAt <= now) pairs.delete(code);
}
function makeCode() {
  cleanExpiredPairs();
  let code;
  do { code = String(randomInt(100000, 1000000)); } while (pairs.has(code));
  return code;
}
function cleanName(value) { return String(value || '').trim().slice(0, 30) || '연인'; }

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/pair/create', (req, res) => {
  const code = makeCode();
  pairs.set(code, { code, names: [cleanName(req.body?.name)], expiresAt: Date.now() + PAIR_TTL_MS });
  res.json({ ok: true, code, expiresInSeconds: PAIR_TTL_MS / 1000 });
});
app.post('/api/pair/join', (req, res) => {
  cleanExpiredPairs();
  const code = String(req.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, message: '6자리 숫자 코드를 입력해주세요.' });
  const pair = pairs.get(code);
  if (!pair) return res.status(404).json({ ok: false, message: '코드가 없거나 만료됐어요. 다시 확인해주세요.' });
  if (pair.names.length >= 2) return res.status(409).json({ ok: false, message: '이미 연결된 코드예요.' });
  pair.names.push(cleanName(req.body?.name));
  res.json({ ok: true, code, names: pair.names });
});
app.get('/api/pair/:code', (req, res) => {
  cleanExpiredPairs();
  const pair = pairs.get(String(req.params.code || ''));
  if (!pair) return res.status(404).json({ ok: false, message: '코드가 만료됐어요. 새 코드를 만들어주세요.' });
  res.json({ ok: true, paired: pair.names.length === 2, names: pair.names });
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, () => console.log(`Flower Letter listening on port ${PORT}`));
