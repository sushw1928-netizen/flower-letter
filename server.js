const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { randomInt } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PAIR_TTL_MS = 15 * 60 * 1000;
const pairs = new Map();
const allowedFlowers = new Set(['장미', '튤립', '해바라기', '데이지']);
const allowedWrapping = new Set(['크림색', '분홍색', '하늘색', '라벤더']);
const allowedRibbon = new Set(['빨간 리본', '분홍 리본', '노란 리본', '민트 리본']);
const pairStorageKey = 'flower-letter-active-pair-v1';

app.use(express.json({ limit: '16kb' }));
app.use(express.static(__dirname, { index: false }));

function cleanExpiredPairs() {
  const now = Date.now();
  for (const [code, pair] of pairs) if (pair.names.length < 2 && pair.expiresAt <= now) pairs.delete(code);
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
  return { code: pair.code, names: pair.names, paired: pair.names.length === 2, gardenName: pair.gardenName, anniversary: pair.anniversary, flowers: pair.flowers };
}
function memberIndex(req, pair) {
  const index = Number(req.body?.memberIndex);
  return Number.isInteger(index) && index >= 0 && index < pair.names.length ? index : -1;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/pair/create', (req, res) => {
  const code = makeCode();
  pairs.set(code, { code, names: [cleanName(req.body?.name)], gardenName: '', anniversary: '', flowers: [], expiresAt: Date.now() + PAIR_TTL_MS });
  res.json({ ok: true, code, expiresInSeconds: PAIR_TTL_MS / 1000 });
});
app.post('/api/pair/join', (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, message: '6자리 숫자 코드를 입력해주세요.' });
  const pair = getPair(code);
  if (!pair) return res.status(404).json({ ok: false, message: '코드가 없거나 만료됐어요. 다시 확인해���세요.' });
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
  const selected = Array.isArray(req.body?.bouquet) ? req.body.bouquet : [req.body?.flower];
  const bouquet = [...new Set(selected.map((item) => String(item)))].filter((item) => allowedFlowers.has(item)).slice(0, 12);
  if (!bouquet.length) return res.status(400).json({ ok: false, message: '꽃다발에 넣을 꽃을 하나 이상 골라주세요.' });
  const wrapping = String(req.body?.wrapping || '크림색');
  const ribbon = String(req.body?.ribbon || '빨간 리본');
  if (!allowedWrapping.has(wrapping) || !allowedRibbon.has(ribbon)) return res.status(400).json({ ok: false, message: '포장지나 리본을 다시 골라주세요.' });
  const senderIndex = memberIndex(req, pair);
  pair.flowers.push({
    flower: bouquet[0], bouquet, wrapping, ribbon,
    title: String(req.body?.title || '').trim().slice(0, 60) || '마음을 담은 꽃다발',
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

const bouquetMarkup = `
<div class="bouquet-builder" id="bouquet-builder">
  <div class="bouquet-builder-heading"><span>🌷</span><div><strong>우리만의 꽃다발 만들기</strong><small>꽃을 여러 가지 골라 마음을 듬뿍 담아보세요.</small></div></div>
  <p class="builder-label">꽃 고르기 <span>여러 개 선택 가능</span></p>
  <p class="builder-hint" id="bouquet-hint">꽃을 하나 이상 골라주세요.</p>
  <div class="bouquet-preview" id="bouquet-preview" aria-live="polite"><div class="wrapping-preview"><span id="preview-blooms">🌹</span><i id="preview-ribbon">🎀</i></div><small id="bouquet-preview-label">나만의 꽃다발</small></div>
  <p class="builder-label">포장지</p><div class="option-row" id="wrapping-options">
    <button type="button" class="finish-option is-active" data-wrapping="크림색"><i class="paper-swatch paper-cream"></i>크림</button>
    <button type="button" class="finish-option" data-wrapping="분홍색"><i class="paper-swatch paper-pink"></i>분홍</button>
    <button type="button" class="finish-option" data-wrapping="하늘색"><i class="paper-swatch paper-blue"></i>하늘</button>
    <button type="button" class="finish-option" data-wrapping="라벤더"><i class="paper-swatch paper-lavender"></i>라벤더</button>
  </div>
  <p class="builder-label">리본</p><div class="option-row" id="ribbon-options">
    <button type="button" class="finish-option is-active" data-ribbon="빨간 리본">❤️ 빨강</button>
    <button type="button" class="finish-option" data-ribbon="분홍 리본">💗 분홍</button>
    <button type="button" class="finish-option" data-ribbon="노란 리본">💛 노랑</button>
    <button type="button" class="finish-option" data-ribbon="민트 리본">💚 민트</button>
  </div>
</div>`;
const bouquetCss = `<style>
.bouquet-builder{margin:18px 0;padding:16px;border:1px solid #eadcdd;border-radius:22px;background:linear-gradient(155deg,#fffdfa,#fff4f3);box-shadow:0 10px 24px rgba(96,72,78,.07)}
.bouquet-builder-heading{display:flex;align-items:center;gap:11px;color:#513f43}.bouquet-builder-heading>span{font-size:35px}.bouquet-builder-heading strong,.bouquet-builder-heading small{display:block}.bouquet-builder-heading strong{font-size:18px}.bouquet-builder-heading small{margin-top:4px;color:#8b777b;font-size:12px;line-height:1.45}
.builder-label{margin:16px 0 8px!important;color:#594b4f!important;font-size:14px!important;font-weight:700}.builder-label span{margin-left:5px;color:#a38b90;font-size:12px;font-weight:400}.builder-hint{margin:0;color:#9b7e84;font-size:13px}
#flowers .choices{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.bouquet-builder~.choices .choice{min-height:67px;padding:10px;border-radius:15px}.bouquet-builder~.choices .choice[aria-pressed="true"]{border:2px solid #cf7181;background:#fff0f3;box-shadow:0 4px 12px rgba(207,113,129,.12)}
.bouquet-preview{display:grid;place-items:center;min-height:170px;margin-top:12px;padding:10px;border-radius:18px;background:radial-gradient(ellipse at 50% 80%,#e9f4d8,#fff8eb 72%);overflow:hidden}.wrapping-preview{position:relative;display:grid;place-items:center;width:120px;height:118px;padding-top:0;clip-path:polygon(8% 10%,50% 38%,92% 10%,78% 100%,22% 100%);background:linear-gradient(115deg,#f5e8d0,#fff6e6 52%,#ead8bb);filter:drop-shadow(0 6px 5px rgba(92,72,54,.18));transition:background .2s}.wrapping-preview:before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent 47%,rgba(255,255,255,.55) 49%,transparent 53%);pointer-events:none}.wrapping-preview>span{z-index:1;margin-top:-22px;font-size:49px;letter-spacing:-14px;filter:drop-shadow(0 3px 2px rgba(80,51,60,.13))}.wrapping-preview>i{position:absolute;z-index:2;bottom:25px;left:50%;transform:translateX(-50%);font-size:27px;font-style:normal}.bouquet-preview>small{margin-top:6px;color:#856c70;font-weight:700}
.option-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.finish-option{display:grid;place-items:center;gap:3px;min-height:47px;padding:6px 3px;border:1px solid #e8dcdd;border-radius:12px;background:#fff;color:#6b585d;font:inherit;font-size:11px;cursor:pointer}.finish-option.is-active{border:2px solid #cf7181;background:#fff4f5;color:#9d5260;font-weight:700}.paper-swatch{display:block;width:25px;height:20px;border:1px solid rgba(75,50,45,.12);border-radius:5px;box-shadow:inset 4px 0 rgba(255,255,255,.38)}.paper-cream{background:#f4e5c8}.paper-pink{background:#efb9c9}.paper-blue{background:#a9d8e8}.paper-lavender{background:#c9b8e3}.wrapping-preview.paper-pink{background:linear-gradient(115deg,#e9aabc,#fff0f4 52%,#dc91a8)}.wrapping-preview.paper-blue{background:linear-gradient(115deg,#8ec6dc,#e9f8ff 52%,#72b3cd)}.wrapping-preview.paper-lavender{background:linear-gradient(115deg,#b39bd4,#f2eaff 52%,#9a82c1)}
</style>`;
const persistenceScript = `
<script>
(() => {
  const storageKey = ${JSON.stringify(pairStorageKey)};
  const nativeFetch = window.fetch.bind(window);
  window.__bouquetState = { flowers: ['장미'], wrapping: '크림색', ribbon: '빨간 리본' };
  window.fetch = async (input, init = {}) => {
    const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input.url;
    if (method === 'POST' && /\/api\/pair\/[^/]+\/flowers$/.test(url) && init.body) {
      try { init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), bouquet: window.__bouquetState.flowers, wrapping: window.__bouquetState.wrapping, ribbon: window.__bouquetState.ribbon }) }; } catch {}
    }
    const response = await nativeFetch(input, init);
    if (method === 'DELETE' && /\/api\/pair\//.test(url) && response.ok) localStorage.removeItem(storageKey);
    if (method === 'POST' && /\/api\/pair\/(create|join)$/.test(url) && response.ok) {
      try { const data = await response.clone().json(); if (data.code) localStorage.setItem(storageKey, JSON.stringify({ code: data.code, memberIndex: /\/api\/pair\/join$/.test(url) ? 1 : 0 })); } catch {}
    }
    return response;
  };
  function setupBouquet() {
    const builder = document.getElementById('bouquet-builder');
    if (!builder) return;
    const state = window.__bouquetState;
    const choices = [...document.querySelectorAll('#flowers .choice')];
    function drawPreview() {
      const emojis = state.flowers.map(name => ({장미:'🌹',튤립:'🌷',해바라기:'🌻',데이지:'🌼'})[name]).filter(Boolean);
      document.getElementById('preview-blooms').textContent = emojis.length ? emojis.join('') : '🌱';
      document.getElementById('bouquet-preview-label').textContent = emojis.length ? `${emojis.length}가지 꽃을 담은 꽃다발` : '꽃을 골라 꽃다발을 만들어보세요';
      document.getElementById('bouquet-hint').textContent = emojis.length ? `${state.flowers.join(' · ')} 선택했어요` : '꽃을 하나 이상 골라주세요.';
      document.querySelector('.wrapping-preview').classList.remove('paper-pink','paper-blue','paper-lavender');
      const paperClass = {'분홍색':'paper-pink','하늘색':'paper-blue','라벤더':'paper-lavender'}[state.wrapping];
      if (paperClass) document.querySelector('.wrapping-preview').classList.add(paperClass);
      document.getElementById('preview-ribbon').textContent = ({'빨간 리본':'🎀','분홍 리본':'🎀','노란 리본':'🎀','민트 리본':'🎀'})[state.ribbon];
      document.getElementById('preview-ribbon').style.filter = ({'빨간 리본':'hue-rotate(320deg)','분홍 리본':'hue-rotate(285deg)','노란 리본':'hue-rotate(35deg)','민트 리본':'hue-rotate(100deg)'})[state.ribbon];
    }
    choices.forEach(button => button.addEventListener('click', () => {
      const name = button.dataset.flower;
      if (state.flowers.includes(name)) state.flowers = state.flowers.filter(item => item !== name);
      else if (state.flowers.length < 12) state.flowers.push(name);
      choices.forEach(choice => choice.setAttribute('aria-pressed', String(state.flowers.includes(choice.dataset.flower))));
      if (state.flowers.length) selectedFlower = state.flowers[0];
      drawPreview();
    }));
    document.querySelectorAll('[data-wrapping]').forEach(button => button.addEventListener('click', () => {
      state.wrapping = button.dataset.wrapping;
      document.querySelectorAll('[data-wrapping]').forEach(item => item.classList.toggle('is-active', item === button));
      drawPreview();
    }));
    document.querySelectorAll('[data-ribbon]').forEach(button => button.addEventListener('click', () => {
      state.ribbon = button.dataset.ribbon;
      document.querySelectorAll('[data-ribbon]').forEach(item => item.classList.toggle('is-active', item === button));
      drawPreview();
    }));
    drawPreview();
  }
  async function restorePair() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { localStorage.removeItem(storageKey); }
    if (!saved || !saved.code) return;
    try {
      const pair = await api('/api/pair/' + encodeURIComponent(saved.code), undefined, 'GET');
      currentCode = saved.code; memberIndex = typeof saved.memberIndex === 'number' ? saved.memberIndex : 0;
      if (pair.paired) showConnectedHome(pair);
      else { showScreen('pair'); setStatus('create-status', '연결 코드를 다시 확인하고 있어요…'); startPairPolling(saved.code); }
    } catch { localStorage.removeItem(storageKey); }
  }
  window.addEventListener('load', () => { setupBouquet(); restorePair(); });
})();
</script>`;

app.get('*', async (_req, res, next) => {
  try {
    let html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
    html = html.replace('아직 편지가 없어요. 첫 꽃편지로 우리만의 이야기를 시작해보세요 💌', '아직 받은 꽃이 없어요');
    html = html.replace('<div class="choices" role="group" aria-label="꽃 선택">', `${bouquetMarkup}\n<div class="choices" role="group" aria-label="꽃 선택">`);
    html = html.replace('</head>', `${bouquetCss}\n  <link rel="stylesheet" href="/fairytale-garden.css">\n</head>`);
    html = html.replace('</body>', `${persistenceScript}</body>`);
    res.type('html').send(html);
  } catch (error) { next(error); }
});

app.listen(PORT, () => console.log(`Flower Letter listening on port ${PORT}`));
