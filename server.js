const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { randomInt } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PAIR_TTL_MS = 15 * 60 * 1000;
const pairs = new Map();
const allowedFlowers = new Set(['장미', '튤립', '해바라기', '데이지']);
const pairStorageKey = 'flower-letter-active-pair-v1';

app.use(express.json({ limit: '16kb' }));
app.use(express.static(__dirname, { index: false }));

function cleanExpiredPairs() {
  const now = Date.now();
  for (const [code, pair] of pairs) {
    if (pair.names.length < 2 && pair.expiresAt <= now) pairs.delete(code);
  }
}
function makeCode() {
  cleanExpiredPairs();
  let code;
  do { code = String(randomInt(100000, 1000000)); } while (pairs.has(code));
  return code;
}
function cleanName(value) { return String(value || '').trim().slice(0, 30) || '연인'; }
function getPair(code) {
  cleanExpiredPairs();
  return pairs.get(String(code || ''));
}
function pairView(pair) {
  return {
    code: pair.code,
    names: pair.names,
    paired: pair.names.length === 2,
    gardenName: pair.gardenName,
    anniversary: pair.anniversary,
    flowers: pair.flowers
  };
}
function memberIndex(req, pair) {
  const index = Number(req.body?.memberIndex);
  return Number.isInteger(index) && index >= 0 && index < pair.names.length ? index : -1;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/pair/create', (req, res) => {
  const code = makeCode();
  pairs.set(code, {
    code,
    names: [cleanName(req.body?.name)],
    gardenName: '',
    anniversary: '',
    flowers: [],
    expiresAt: Date.now() + PAIR_TTL_MS
  });
  res.json({ ok: true, code, expiresInSeconds: PAIR_TTL_MS / 1000 });
});
app.post('/api/pair/join', (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, message: '6자리 숫자 코드를 입력해주세요.' });
  const pair = getPair(code);
  if (!pair) return res.status(404).json({ ok: false, message: '코드가 없거나 만료됐어요. 다시 확인해주세요.' });
  if (pair.names.length >= 2) return res.status(409).json({ ok: false, message: '이미 연결된 코드예요.' });
  pair.names.push(cleanName(req.body?.name));
  res.json({ ok: true, ...pairView(pair), memberIndex: 1 });
});
app.get('/api/pair/:code', (req, res) => {
  const pair = getPair(req.params.code);
  if (!pair) return res.status(404).json({ ok: false, message: '연결 코드가 만료됐어요. 새 코드를 만들어주세요.' });
  res.json({ ok: true, ...pairView(pair) });
});
app.put('/api/pair/:code/profile', (req, res) => {
  const pair = getPair(req.params.code);
  if (!pair) return res.status(404).json({ ok: false, message: '연결이 만료됐어요. 다시 연결해주세요.' });
  const index = memberIndex(req, pair);
  if (index < 0) return res.status(400).json({ ok: false, message: '이름을 바꿀 수 있는 연결 정보가 없어요. 다시 연결해주세요.' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, message: '이름을 입력해주세요.' });
  pair.names[index] = cleanName(name);
  res.json({ ok: true, ...pairView(pair), memberIndex: index });
});
app.put('/api/pair/:code/garden', (req, res) => {
  const pair = getPair(req.params.code);
  if (!pair) return res.status(404).json({ ok: false, message: '연결이 만료됐어요. 다시 연결해주세요.' });
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ ok: false, message: '정원 이름을 입력해주세요.' });
  pair.gardenName = name;
  res.json({ ok: true, ...pairView(pair) });
});
app.put('/api/pair/:code/anniversary', (req, res) => {
  const pair = getPair(req.params.code);
  if (!pair) return res.status(404).json({ ok: false, message: '연결이 만료됐어요. 다시 연결해주세요.' });
  const date = String(req.body?.date || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, message: '기념일을 년·월·일 형식으로 입력해주세요.' });
  pair.anniversary = date;
  res.json({ ok: true, ...pairView(pair) });
});
app.post('/api/pair/:code/flowers', (req, res) => {
  const pair = getPair(req.params.code);
  if (!pair) return res.status(404).json({ ok: false, message: '연결이 만료됐어요. 다시 연결해주세요.' });
  if (pair.names.length !== 2) return res.status(409).json({ ok: false, message: '두 사람이 연결된 뒤 꽃을 선물할 수 있어요.' });
  const flower = String(req.body?.flower || '');
  if (!allowedFlowers.has(flower)) return res.status(400).json({ ok: false, message: '꽃을 다시 골라주세요.' });
  const senderIndex = memberIndex(req, pair);
  pair.flowers.push({
    flower,
    title: String(req.body?.title || '').trim().slice(0, 60) || `${flower} 꽃편지`,
    recipient: String(req.body?.recipient || '').trim().slice(0, 30),
    message: String(req.body?.message || '').trim().slice(0, 2000),
    sender: senderIndex >= 0 ? pair.names[senderIndex] : '우리',
    senderIndex,
    createdAt: Date.now()
  });
  res.json({ ok: true, ...pairView(pair) });
});
app.delete('/api/pair/:code', (req, res) => {
  const pair = getPair(req.params.code);
  if (!pair) return res.status(404).json({ ok: false, message: '연결을 찾을 수 없어요.' });
  pairs.delete(pair.code);
  res.json({ ok: true });
});

const persistenceScript = `
<script>
(() => {
  const storageKey = ${JSON.stringify(pairStorageKey)};
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input.url;
    const response = await nativeFetch(input, init);
    if (method === 'DELETE' && /\/api\/pair\//.test(url) && response.ok) localStorage.removeItem(storageKey);
    if (method === 'POST' && /\/api\/pair\/(create|join)$/.test(url) && response.ok) {
      try {
        const data = await response.clone().json();
        if (data.code) localStorage.setItem(storageKey, JSON.stringify({ code: data.code, memberIndex: /\/api\/pair\/join$/.test(url) ? 1 : 0 }));
      } catch {}
    }
    return response;
  };
  async function restorePair() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { localStorage.removeItem(storageKey); }
    if (!saved || !saved.code) return;
    try {
      const pair = await api('/api/pair/' + encodeURIComponent(saved.code), undefined, 'GET');
      currentCode = saved.code;
      memberIndex = typeof saved.memberIndex === 'number' ? saved.memberIndex : 0;
      if (pair.paired) showConnectedHome(pair);
      else { showScreen('pair'); setStatus('create-status', '연결 코드를 다시 확인하고 있어요…'); startPairPolling(saved.code); }
    } catch { localStorage.removeItem(storageKey); }
  }
  window.addEventListener('load', restorePair);
})();
</script>`;

app.get('*', async (_req, res, next) => {
  try {
    let html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
    html = html.replace('아직 편지가 없어요. 첫 꽃편지로 우리만의 이야기를 시작해보세요 💌', '아직 받은 꽃이 없어요');
    html = html.replace('</head>', '  <link rel="stylesheet" href="/fairytale-garden.css">\n</head>');
    html = html.replace('</body>', `${persistenceScript}</body>`);
    res.type('html').send(html);
  } catch (error) { next(error); }
});

app.listen(PORT, () => console.log(`Flower Letter listening on port ${PORT}`));
