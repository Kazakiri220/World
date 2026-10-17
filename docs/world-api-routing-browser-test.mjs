// node docs/world-api-routing-browser-test.mjs [puppeteer 模块名或 file: URL] [Chrome 路径]
// 使用真实完整面板、事件绑定及悬浮球观察器。聊天、存储和连接均为内存夹具，禁止网络请求。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const loaded = await import(process.argv[2] || 'puppeteer');
const puppeteer = loaded.puppeteer || loaded.default;
const files = ['world-engine-core.js', 'world-engine-time.js', 'world-engine-ledger.js',
  'world-engine-evolution.js', 'world-engine-api.js', 'world-engine-chatcache.js',
  'world-engine-worldbook.js', 'memory-engine-settings.js', 'memory-engine-data.js', 'world-engine-ui.js'];
let css = read('style.css');
for (const file of ['worldmap.svg', 'fingerprint-outline-with-magnifying-glass-svgrepo-com.svg']) {
  const data = fs.readFileSync(new URL(file, root)).toString('base64');
  css = css.replaceAll(`url("${file}")`, `url("data:image/svg+xml;base64,${data}")`);
}
const bootstrap = `
  const values = new Map();
  window.WORLD_ENGINE_STORE = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  const profiles = [{ id: 't1', name: '酒馆主力', model: 'model-t1' }, { id: 't2', name: '酒馆备用', model: 'model-t2' }];
  const context = { chatId: 'offline-ui', chat: [], chatMetadata: {},
    extensionSettings: { disabledExtensions: [], connectionManager: { profiles } },
    ConnectionManagerRequestService: { getSupportedProfiles: () => profiles } };
  window.SillyTavern = { getContext: () => context };
  window.fetch = () => { throw Error('离线 UI 测试禁止 API 请求'); };
  window.fixture = { values };
`;
const start = `
  const api = WORLD_ENGINE_API, refs = [];
  for (let i = 0; i < 30; i++) {
    const p = api.saveApiProfile('供应商 ' + i, { apiUrl: 'https://example.test/' + i, apiKey: 'fake-key', model: 'model-' + i });
    refs.push('custom:' + p.id);
  }
  values.set('world_engine_settings', JSON.stringify({ apiPoolEnabled: true, apiPool: [refs[0], 'tavern:t1'], apiRpmLimit: 0 }));
  MEMORY_ENGINE_SETTINGS.patchSettings({ apiPoolEnabled: true, apiPool: [refs[1], 'tavern:t2'], apiRpmLimit: 0 });
  // 世界书读取是外部服务；本测试不加载酒馆或真实聊天。
  WORLD_ENGINE_WORLDBOOK.loadCurrentEntries = async () => [];
  WORLD_ENGINE_UI.buildInputButton();
  WORLD_ENGINE_UI.showPanel();
  document.getElementById('we-btn-settings-open').click();
`;
const script = source => '<script>' + source.replace(/<\/script/gi, '<\\/script') + '</script>';
const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>完整面板离线回归</title><style>'
  + css + '</style><body><div id="chat"></div>' + script(bootstrap)
  + files.map(file => script(read(file))).join('') + script(start) + '</body></html>';

const browser = await puppeteer.launch({ executablePath: process.argv[3] || undefined,
  headless: true, protocolTimeout: 10000, defaultViewport: { width: 1100, height: 900 } });
try {
  console.log('Browser: ' + await browser.version());
  const page = await browser.newPage(), failures = [], requests = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => failures.push(error.message));
  page.on('error', error => failures.push('renderer: ' + error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith('data:')) request.continue();
    else { requests.push(request.url()); request.abort(); }
  });
  await page.setContent(html);

  async function exercise(scope) {
    await page.waitForSelector('#we-api-pool-trigger');
    assert.equal(await page.$eval('#we-api-pool-menu', el => el.hidden), true);
    await page.click('#we-api-pool-trigger');
    assert.equal(await page.$eval('#we-api-pool-trigger', el => el.getAttribute('aria-expanded')), 'true');
    assert.equal(await page.$eval('#we-api-pool-menu', el => el.scrollHeight > el.clientHeight), true);
    await page.evaluate(() => {
      const trigger = document.getElementById('we-api-pool-trigger');
      window.fixture.nodes = [trigger, trigger.querySelector('.we-api-pool-value').firstChild,
        trigger.querySelector('.we-api-pool-count').firstChild, document.getElementById('we-api-pool-menu')];
      window.fixture.childMutations = 0;
      window.fixture.observer = new MutationObserver(records => { window.fixture.childMutations += records.length; });
      window.fixture.observer.observe(document.getElementById('we-api-pool-select'), { childList: true, subtree: true });
    });
    const choices = await page.$$('.we-api-pool-ref');
    // 重点覆盖用户报告的“第一项偶尔正常、选择第二项后崩溃”，并持续重复。
    for (let i = 0; i < 40; i++) {
      await choices[i % 2].click();
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('we-api-pool-ref')), true);
      assert.equal(await page.$eval('#we-api-pool-menu', el => el.hidden), false);
    }
    await choices.at(-1).click(); // 同时选择酒馆预设，滚动到菜单末端。
    const scroll = await page.$eval('#we-api-pool-menu', el => el.scrollTop);
    await choices.at(-2).click();
    assert.equal(await page.$eval('#we-api-pool-menu', el => el.scrollTop), scroll, '勾选应保留菜单滚动位置');
    assert.equal(await page.evaluate(() => {
      const [trigger, value, count, menu] = fixture.nodes;
      return trigger === document.getElementById('we-api-pool-trigger')
        && value === trigger.querySelector('.we-api-pool-value').firstChild
        && count === trigger.querySelector('.we-api-pool-count').firstChild
        && menu === document.getElementById('we-api-pool-menu') && fixture.childMutations === 0;
    }), true, '连续勾选不得替换 DOM 或触发子树重建');
    await page.evaluate(() => fixture.observer.disconnect());
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#we-api-pool-menu', el => el.hidden), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'we-api-pool-trigger');
    assert.equal(await page.$eval('#we-panel', el => getComputedStyle(el).display), 'flex', 'Esc 只收起菜单');
    await page.click('#we-api-pool-trigger');
    await page.click('#we-api-rpm');
    assert.equal(await page.$eval('#we-api-pool-menu', el => el.hidden), true);
    await page.focus('#we-api-pool-trigger');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('we-api-pool-ref')), true);
    await page.keyboard.press('Escape');
    const selected = await page.$$eval('.we-api-pool-ref:checked', els => els.map(el => el.dataset.apiRef));
    await page.click('#we-api-pool-enabled');
    assert.equal(await page.$eval('#we-api-pool-config', el => el.hidden), true);
    await page.click('#we-api-pool-enabled');
    assert.deepEqual(await page.$$eval('.we-api-pool-ref:checked', els => els.map(el => el.dataset.apiRef)), selected);
    await page.$eval('#we-api-rpm', el => { el.value = '7'; });
    await page.click(scope === 'memory' ? '#we-save-memory-settings' : '#we-save-settings');
    const stored = await page.evaluate(scope => JSON.parse(fixture.values.get(scope + '_engine_settings')), scope);
    assert.deepEqual(stored.apiPool, selected); assert.equal(stored.apiRpmLimit, 7);
    await page.evaluate(() => WORLD_ENGINE_UI.refresh());
    assert.deepEqual(await page.$$eval('.we-api-pool-ref:checked', els => els.map(el => el.dataset.apiRef)), selected);
    // 通过真正的保存按钮，把一个仍在等待的请求从 RPM=1 切换到 RPM=0。
    const saveSelector = scope === 'memory' ? '#we-save-memory-settings' : '#we-save-settings';
    await page.$eval('#we-api-rpm', el => { el.value = '1'; }); await page.click(saveSelector);
    await page.evaluate(async scope => {
      const settings = scope === 'memory' ? MEMORY_ENGINE_SETTINGS.getSettings(true) : WORLD_ENGINE_API.getSettings(true);
      const snapshot = { ...settings, apiSource: 'custom', apiPoolEnabled: false,
        apiUrl: 'https://offline.test', apiKey: 'fake-key', apiTimeoutMs: 1000 };
      window.fetch = async () => ({ ok: true, status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'offline-ok' } }] }) });
      await WORLD_ENGINE_API.callApi('测试', 16, 0, null, snapshot);
      fixture.rpmOutcome = 'pending';
      WORLD_ENGINE_API.callApi('测试', 16, 0, null, snapshot)
        .then(value => { fixture.rpmOutcome = value; }).catch(error => { fixture.rpmOutcome = error.message; });
    }, scope);
    await page.waitForFunction(scope => WORLD_ENGINE_API.getRoutingStatus(scope)?.state === 'waiting', {}, scope);
    await page.$eval('#we-api-rpm', el => { el.value = '0'; }); await page.click(saveSelector);
    await page.waitForFunction(() => fixture.rpmOutcome !== 'pending', { timeout: 4000 });
    assert.equal(await page.evaluate(() => fixture.rpmOutcome), 'offline-ok', '保存 RPM=0 后原请求必须恢复');
    assert.equal(await page.evaluate(scope => JSON.parse(fixture.values.get(scope + '_engine_settings')).apiRpmLimit, scope), 0);
    console.log('✓ ' + scope + ': 连续多选、稳定 DOM、键盘及实际保存；原请求在保存 RPM=0 后恢复通过');
  }
  await exercise('world');
  await page.click('.we-engine-face-toggle');
  await page.waitForFunction(() => document.getElementById('we-panel').classList.contains('we-memory-face')
    && !document.getElementById('we-panel').classList.contains('we-panel-flip-in'));
  await page.waitForFunction(() => !document.getElementById('we-panel').getAnimations().some(animation => animation.playState === 'running'));
  await page.click('#we-btn-settings-open');
  await exercise('memory');
  await page.setViewport({ width: 360, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.weTheme = 'paper'; });
  await page.click('#we-api-pool-trigger');
  const size = await page.$eval('#we-api-pool-select', el => ({ width: el.clientWidth, content: el.scrollWidth }));
  assert.equal(size.content <= size.width, true, '窄面板下拉框不得横向溢出');
  assert.deepEqual(failures, []); assert.deepEqual(requests, []);
  if (process.env.WORLD_UI_SCREENSHOT) await page.screenshot({ path: process.env.WORLD_UI_SCREENSHOT, waitForFonts: false });
  console.log('✓ 两引擎无脚本异常/标签页崩溃、无网络请求；360px 浅色主题通过 (' + fileURLToPath(root) + ')');
} finally {
  await browser.close();
}
