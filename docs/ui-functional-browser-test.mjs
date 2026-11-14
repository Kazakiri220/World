// node docs/ui-functional-browser-test.mjs [puppeteer module/file URL] [Chrome path]
// Real entry point, modules, event bus, DOM, storage and API routing; synthetic chat/provider only.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const loaded = await import(process.argv[2] || 'puppeteer');
const puppeteer = loaded.puppeteer || loaded.default;
const bootstrap = `
  const handlers = new Map(), injections = new Map();
  const context = { chatId: 'functional', chatMetadata: {}, extensionSettings: {},
    name1: '用户', name2: '角色', chat: [{ is_user: false, mes: '开场白' }],
    event_types: { GENERATION_ENDED: 'generation_ended', GENERATION_STARTED: 'generation_started',
      CHAT_LOADED: 'chat_loaded', MESSAGE_DELETED: 'message_deleted', MESSAGE_SWIPED: 'message_swiped' },
    eventSource: { on(name, fn) { const list = handlers.get(name) || []; list.push(fn); handlers.set(name, list); } },
    setExtensionPrompt: (name, text) => injections.set(name, text), saveChat() {}, saveMetadata() {} };
  window.SillyTavern = { getContext: () => context };
  localStorage.clear();
  localStorage.setItem('world_engine_settings', JSON.stringify({ apiUrl: 'https://provider.test',
    apiKey: 'fake-key', apiTimeoutMs: 15000, apiRpmLimit: 0, evolveMode: 'auto', evolveEveryX: 1,
    localRegionalIncidentChancePercent: 0, localNearEventChancePercent: 0, localDistantEventChancePercent: 0 }));
  localStorage.setItem('memory_engine_settings', JSON.stringify({ apiUrl: 'https://provider.test',
    apiKey: 'fake-key', apiTimeoutMs: 15000, apiRpmLimit: 0, evolveMode: 'manual', hideCoveredRawText: false }));
  window.fixture = { context, handlers, injections, pending: [], requests: [],
    async emit(name, ...args) { for (const fn of handlers.get(name) || []) await fn(...args); },
    async turn(text = '新的回复') {
      await this.emit('generation_started', 'normal', {}, false);
      context.chat.push({ is_user: true, mes: '用户行动' }, { is_user: false, mes: text });
      await this.emit('generation_ended', context.chat.length - 1);
    } };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, options) => {
    if (!String(url).startsWith('https://provider.test/')) return realFetch(url, options);
    const request = JSON.parse(options.body); fixture.requests.push(request);
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      fixture.pending.push(result => {
        signal?.removeEventListener('abort', abort);
        const text = JSON.stringify(result);
        const content = fixture.textBlocks ? [{ type: 'text', text }] : text;
        resolve(new Response(JSON.stringify(fixture.bareResponse ? result : { choices: [{ message: { content } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }));
      });
    });
  };
`;
const browser = await puppeteer.launch({ executablePath: process.argv[3] || undefined,
  headless: true, defaultViewport: { width: 1100, height: 900 } });
try {
  const page = await browser.newPage(), errors = [], unexpected = [];
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== 'http://world-engine.test') { unexpected.push(request.url()); request.abort(); return; }
    const name = url.pathname.slice(1);
    if (!name) {
      request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8">'
        + '<style>' + read('style.css').replace(/url\([^)]*\)/g, 'none') + '</style><body><div id="chat"></div>'
        + '<script>' + bootstrap + '</script><script src="/world-engine.js"></script></body>' });
    } else if (name === 'scripts/world-info.js') {
      request.respond({ status: 200, contentType: 'text/javascript', body: 'export const getSortedEntries = async () => [];' });
    } else if (/^[\w-]+\.js$/.test(name) || name === 'manifest.json') {
      request.respond({ status: 200, contentType: name.endsWith('.json') ? 'application/json' : 'text/javascript', body: read(name) });
    } else if (name === 'favicon.ico') request.respond({ status: 204 });
    else { unexpected.push(request.url()); request.abort(); }
  });
  await page.goto('http://world-engine.test/');
  await page.waitForFunction(() => window.WORLD_ENGINE && window.MEMORY_ENGINE && fixture.handlers.get('generation_ended')?.length === 2);
  assert.deepEqual(errors, [], 'full entry point must initialize without errors');
  await page.evaluate(() => WORLD_ENGINE_UI.showPanel());

  await page.evaluate(() => fixture.turn());
  await page.waitForFunction(() => fixture.pending.length === 1);
  assert.ok(await page.$('#we-quick-btn-abort'), 'automatic evolution must immediately expose a stop button');
  await page.evaluate(() => fixture.pending.shift()({ world_digest: '自动推演结果' }));
  await page.waitForFunction(() => WORLD_ENGINE_CORE.loadState().round === 1 && !WORLD_ENGINE_EVOLUTION.isRunning());
  assert.equal(await page.evaluate(() => WORLD_ENGINE_CORE.loadState().worldDigest), '自动推演结果');
  console.log('✓ real boot and first AI reply automatically evolve and persist');

  const finishWorld = async (digest, round) => {
    await page.waitForFunction(() => fixture.pending.length === 1);
    await page.evaluate(digest => fixture.pending.shift()({ world_digest: digest }), digest);
    await page.waitForFunction(round => WORLD_ENGINE_CORE.loadState().round === round && !WORLD_ENGINE_EVOLUTION.isRunning(), {}, round);
  };
  await page.click('#we-btn-settings-open');
  await page.click('.we-settings-tab[data-tab="evolve"]');
  await page.select('#we-evolve-mode', 'auto');
  await page.$eval('#we-evolve-everyx', el => { el.value = '2'; });
  await page.click('#we-save-settings');
  assert.equal(await page.evaluate(() => WORLD_ENGINE_API.getSettings(true).evolveEveryX), 2);
  await page.click('#we-btn-back');
  await page.evaluate(() => fixture.turn('第二轮回复'));
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1700)));
  assert.equal(await page.evaluate(() => fixture.pending.length), 0, 'every-two setting must skip the intervening reply');
  await page.evaluate(() => fixture.turn('第三轮回复'));
  await finishWorld('第三轮自动结果', 2);
  await page.evaluate(() => fixture.turn('第四轮回复'));
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1700)));
  assert.equal(await page.evaluate(() => fixture.pending.length), 0, 'checkpoint must not count already processed replies');
  await page.evaluate(() => fixture.turn('第五轮回复'));
  await finishWorld('第五轮自动结果', 3);
  console.log('✓ continuous AI replies and every-two setting through real settings controls');

  // The regenerate action does not necessarily emit MESSAGE_SWIPED; deduplication must reset at generation start.
  await page.evaluate(async () => {
    await fixture.emit('generation_started', 'regenerate', {}, false);
    fixture.context.chat.at(-1).mes = '第五轮重新生成';
    await fixture.emit('generation_ended', fixture.context.chat.length - 1);
  });
  await finishWorld('第五轮重生成结果', 3);
  assert.equal(await page.evaluate(() => WORLD_ENGINE_CORE.loadState().worldDigest), '第五轮重生成结果');
  console.log('✓ regenerate re-runs automatically without MESSAGE_SWIPED and preserves round');

  await page.click('#we-header-mode');
  assert.equal(await page.$eval('.we-settings-tab--active', el => el.dataset.tab), 'evolve');
  await page.$eval('#we-evolve-everyx', el => { el.value = '1'; });
  await page.click('#we-save-settings');
  await page.click('#we-btn-back');
  await page.click('.we-chip-btn[data-view="events"]');
  await page.click('[data-add-section="events"]');
  await page.type('.we-event-edit-name', '未保存的草稿');
  await page.click('.we-chip-btn[data-view="home"]');
  await page.evaluate(() => fixture.turn('第六轮回复'));
  await page.evaluate(() => { fixture.textBlocks = true; });
  await finishWorld('离开编辑页后的结果', 4);
  await page.waitForFunction(() => document.getElementById('we-header-round').textContent.includes('第 4 轮'));
  assert.equal(await page.$('.we-event-editor'), null);
  console.log('✓ leaving a card editor does not freeze subsequent automatic UI refresh');

  const cards = [
    ['situation', 'trends', 'trend', 'name', 'worldTrends'],
    ['events', 'events', 'event', 'name', 'events'],
    ['events', 'winds', 'wind', 'topic', 'winds'],
    ['events', 'influence', 'influence', 'trigger', 'influenceChain'],
    ['relations', 'factions', 'faction', 'name', 'factions'],
    ['relations', 'enemies', 'enemy', 'name', 'enemies']
  ];
  for (const [view, section, type, field, collection] of cards) {
    await page.click(`.we-chip-btn[data-view="${view}"]`);
    await page.click(`[data-add-section="${section}"]`);
    await page.type(`.we-${type}-edit-${field}`, '手动添加-' + section);
    if (type === 'influence') await page.type('.we-influence-edit-impact', '直接影响');
    // A background refresh must preserve an actively edited form.
    await page.evaluate(() => WORLD_ENGINE_UI.refresh(true));
    assert.equal(await page.$eval(`.we-${type}-edit-${field}`, el => el.value), '手动添加-' + section);
    await page.click(`.we-${type}-editor-save`);
    assert.equal(await page.evaluate(({ collection, field }) => WORLD_ENGINE_CORE.loadState()[collection][0][field], { collection, field }), '手动添加-' + section);
  }
  await page.click('.we-chip-btn[data-view="situation"]');
  await page.click('.we-time-annotations[data-time-path="worldTrends"] > summary');
  await page.type('[data-time-path="worldTrends"] [data-time-field="occurredAt"]', '永明三年春');
  await page.click('[data-time-path="worldTrends"] .we-time-save');
  assert.equal(await page.evaluate(() => WORLD_ENGINE_CORE.loadState().worldTrends[0].time.occurredAt.text), '永明三年春');
  console.log('✓ all six new card forms save real data; live editors and manual story time remain usable');

  await page.click('.we-engine-tab-memory');
  await page.waitForFunction(() => document.getElementById('we-panel').classList.contains('we-memory-face'));
  await page.waitForFunction(() => !document.getElementById('we-panel').getAnimations().some(a => a.playState === 'running'));
  await page.click('#we-quick-btn-memory-extract');
  await page.waitForFunction(() => fixture.pending.length === 1);
  assert.ok(await page.$('#we-quick-btn-abort'), 'memory tasks must expose stop immediately');
  assert.equal(await page.$eval('#we-quick-btn-memory-overview', el => el.disabled), true);
  await page.evaluate(() => fixture.pending.shift()({
    personal_memory: [{ name: ['角色'], known_by: [], memory: '角色记住了本轮事件。', time: '' }],
    entity_updates: [], small_summary: '本轮事件纪要。'
  }));
  await page.waitForFunction(() => !MEMORY_ENGINE.isRunning());
  assert.ok(await page.$('#we-quick-btn-memory-extract'), 'completion restores the extract action');
  await page.click('#we-quick-btn-memory-overview');
  await page.waitForFunction(() => fixture.pending.length === 1);
  await page.evaluate(() => fixture.pending.shift()({ big_summary: '故事总述。' }));
  await page.waitForFunction(() => !MEMORY_ENGINE.isRunning());
  assert.equal(await page.evaluate(() => MEMORY_ENGINE_DATA.loadState().event_memory.big_summaries.length), 1);
  await page.click('#we-quick-btn-memory-overview');
  await page.waitForFunction(() => [...document.querySelectorAll('.we-toast')].some(el => el.textContent.includes('没有尚未并入总述的纪要')));
  console.log('✓ memory extract/summary task controls, persisted results and visible failure reasons');

  // World updates in the background must neither stop on the memory face nor overwrite settings inputs.
  await page.click('#we-btn-settings-open');
  await page.$eval('#we-api-rpm', el => { el.value = '37'; });
  await page.evaluate(() => fixture.turn('后台世界更新'));
  await finishWorld('记忆面打开时的世界结果', 5);
  assert.equal(await page.$eval('#we-api-rpm', el => el.value), '37');
  await page.click('#we-memory-settings-back');
  await page.waitForFunction(() => !document.getElementById('we-panel').getAnimations().some(a => a.playState === 'running'));
  await page.click('.we-engine-tab-world');
  await page.waitForFunction(() => !document.getElementById('we-panel').classList.contains('we-memory-face'));
  await page.waitForFunction(() => !document.getElementById('we-panel').getAnimations().some(a => a.playState === 'running'));
  assert.match(await page.$eval('#we-header-round', el => el.textContent), /第 5 轮/);
  console.log('✓ world auto evolution continues behind memory settings and preserves unsaved inputs');

  // A chat beginning with a user message has only two messages after its first AI reply.
  await page.evaluate(async () => {
    fixture.context.chatId = 'without-opening';
    fixture.context.chatMetadata = {};
    fixture.context.chat = [];
    await fixture.emit('chat_loaded');
    await fixture.turn('没有开场白的首轮回复');
  });
  await finishWorld('两条消息也能自动推演', 1);
  await page.evaluate(() => fixture.emit('generation_ended', 1));
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1700)));
  assert.equal(await page.evaluate(() => fixture.pending.length), 0, 'duplicate completion events must not run twice');
  console.log('✓ first reply without an AI opening and duplicate completion events');

  await page.click('#we-header-mode');
  await page.$eval('#we-world-engine-enabled', el => { el.checked = false; });
  await page.$eval('#we-evolve-everyx', el => { el.value = '2'; });
  await page.click('#we-save-settings');
  await page.click('#we-btn-back');
  assert.equal(await page.$eval('#we-header-mode', el => el.textContent), '引擎已关闭');
  await page.evaluate(async () => { await fixture.turn('关闭期间的回复1'); await fixture.turn('关闭期间的回复2'); });
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1700)));
  assert.equal(await page.evaluate(() => fixture.pending.length), 0);
  await page.click('#we-header-mode');
  await page.$eval('#we-world-engine-enabled', el => { el.checked = true; });
  await page.click('#we-save-settings');
  await page.click('#we-btn-back');
  await page.evaluate(() => { fixture.bareResponse = true; });
  await page.evaluate(() => fixture.turn('重新开启后的回复'));
  await finishWorld('错过阈值后继续自动更新', 2);
  console.log('✓ disabled engines stay idle; re-enabled engines process overdue replies without a modulo dead zone');

  await page.setViewport({ width: 360, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.weTheme = 'paper'; });
  const layout = await page.evaluate(() => {
    const panel = document.getElementById('we-panel');
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#we-header-mood .we-header-mood-text'));
    return { fits: panel.scrollWidth <= panel.clientWidth, moodLines: range.getClientRects().length };
  });
  assert.equal(layout.fits, true, 'the 360px panel must not overflow');
  assert.equal(layout.moodLines, 1, 'the new mode badge must not squeeze the status text into a vertical column');

  if (process.env.WORLD_UI_SCREENSHOT) await page.screenshot({ path: process.env.WORLD_UI_SCREENSHOT, waitForFonts: false });
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error);
  throw error;
} finally { await browser.close(); }
