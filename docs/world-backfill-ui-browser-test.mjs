// node docs/world-backfill-ui-browser-test.mjs [puppeteer 模块或 file: URL] [Chrome 路径]
// 真实面板 + 真实批量更新链；聊天与存储均为内存夹具，API 逐批手动放行。
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const loaded = await import(process.argv[2] || 'puppeteer');
const puppeteer = loaded.puppeteer || loaded.default;
const files = ['world-engine-core.js', 'world-engine-time.js', 'world-engine-ledger.js',
  'world-engine-api.js', 'world-engine-evolution.js', 'world-engine-chatcache.js',
  'world-engine-worldbook.js', 'memory-engine-settings.js', 'memory-engine-data.js', 'world-engine-ui.js'];
const bootstrap = `
  const values = new Map();
  window.WORLD_ENGINE_STORE = { getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  const context = { chatId: 'offline-progress', chatMetadata: {}, extensionSettings: {},
    chat: Array.from({ length: 51 }, (_, i) => ({ is_user: i % 2 === 1, mes: '合成正文-' + i })) };
  window.SillyTavern = { getContext: () => context };
  values.set('world_engine_settings', JSON.stringify({ apiUrl: 'https://offline.test', apiKey: 'fake-key',
    apiRpmLimit: 0, apiTimeoutMs: 0, backfillBatchSize: 1, backfillRetries: 0,
    localRegionalIncidentChancePercent: 0, localDistantEventChancePercent: 0, localNearEventChancePercent: 0 }));
  window.fixture = { context, values, pending: [], requests: 0 };
  window.fetch = async () => {
    const batch = ++fixture.requests;
    await new Promise(resolve => { fixture.pending.push(resolve); });
    return { ok: true, status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ world_digest: '更新-' + batch }) } }] }) };
  };
`;
const script = source => '<script>' + source.replace(/<\/script/gi, '<\\/script') + '</script>';
// 不加载图片或字体；验证完整 UI 和事件，不访问酒馆或真实供应商。
const css = read('style.css').replace(/url\([^)]*\)/g, 'none');
const html = '<!doctype html><meta charset="utf-8"><title>批量更新进度回归</title><style>' + css
  + '</style><body><div id="chat"></div>' + script(bootstrap) + files.map(f => script(read(f))).join('')
  + script(`WORLD_ENGINE_WORLDBOOK.loadCurrentEntries = async () => [];
    WORLD_ENGINE_UI.buildInputButton(); WORLD_ENGINE_UI.showPanel();
    document.getElementById('we-btn-settings-open').click();
    document.getElementById('we-backfill-start').click();`) + '</body>';

const browser = await puppeteer.launch({ executablePath: process.argv[3] || undefined,
  headless: true, protocolTimeout: 10000, defaultViewport: { width: 1100, height: 900 } });
try {
  console.log('Browser: ' + await browser.version());
  const page = await browser.newPage(), failures = [], requests = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => failures.push(error.message));
  page.on('error', error => failures.push('renderer: ' + error.message));
  await page.setRequestInterception(true);
  page.on('request', request => { requests.push(request.url()); request.abort(); });
  await page.setContent(html);
  const status = () => page.$eval('#we-backfill-status', el => el.textContent);
  const count = () => page.$eval('.we-ball-count', el => el.textContent);
  const pending = async n => {
    try { await page.waitForFunction(n => fixture.requests === n && fixture.pending.length === 1, {}, n); }
    catch (error) {
      console.error({ expected: n, failures, state: await page.evaluate(() => ({ requests: fixture.requests,
        status: document.getElementById('we-backfill-status')?.textContent,
        error: WORLD_ENGINE_EVOLUTION.getLastError(), job: WORLD_ENGINE_EVOLUTION.getBackfillJob() })) });
      throw error;
    }
  };
  const release = () => page.evaluate(() => fixture.pending.shift()());
  async function switchFace() {
    await page.evaluate(() => document.querySelector('.we-engine-face-toggle').click());
    await page.waitForFunction(() => !document.getElementById('we-panel').classList.contains('we-panel-flip-out'));
    await page.waitForFunction(() => !document.getElementById('we-panel').getAnimations().some(a => a.playState === 'running'));
    // 翻面还有内部 220ms 防重复操作窗口，等待该窗口结束再点击下一次。
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
  }
  for (let batch = 1; batch <= 25; batch++) {
    await pending(batch);
    assert.match(await status(), new RegExp('第 ' + batch + '/25 批'));
    assert.equal(await count(), batch + '/25', '悬浮球应显示正在处理的批次');
    if (batch === 17) {
      await page.evaluate(() => {
        fixture.oldStatus = document.getElementById('we-backfill-status');
        document.getElementById('we-api-rpm').value = '0';
        document.getElementById('we-save-settings').click();
        WORLD_ENGINE_UI.hidePanel(); WORLD_ENGINE_UI.showPanel();
      });
      assert.equal(await page.evaluate(() => fixture.oldStatus.isConnected), false, '保存后重开面板确实重建了进度节点');
      assert.match(await status(), /第 17\/25 批/, '重建时立即恢复当前批次');
    }
    if (batch === 18) {
      assert.match(await page.evaluate(() => fixture.oldStatus.textContent), /第 17\/25 批/, '任务不应继续写入脱离文档的旧节点');
    }
    if (batch === 19) {
      await page.evaluate(() => { WORLD_ENGINE_UI.hidePanel(); WORLD_ENGINE_UI.showPanel(); });
      assert.match(await status(), /第 19\/25 批/, '关闭再打开保留最新进度');
    }
    if (batch === 21) {
      await switchFace();
      assert.equal(await page.$('#we-backfill-status'), null);
      assert.equal(await count(), '', '记忆面不能保留世界任务的旧数字');
      await release(); await pending(22);
      await switchFace();
      assert.match(await status(), /第 22\/25 批/, '切回世界面恢复后台推进后的当前批次');
      assert.equal(await count(), '22/25');
      // 第 22 批仍在等待，交给下一次循环处理。
      continue;
    }
    await release();
  }
  await page.waitForFunction(() => !WORLD_ENGINE_EVOLUTION.isRunning());
  assert.match(await status(), /更新完成，已处理到第 50 楼/, '结束刷新不能覆盖完成提示');
  assert.equal(await count(), '', '完成后清理悬浮球旧进度');
  assert.equal(await page.$eval('#we-backfill-start', el => el.disabled), false);
  assert.equal(await page.evaluate(() => WORLD_ENGINE_CORE.loadState().processedThrough), 50);
  console.log('✓ 25 批更新：保存设置后 17/25→18/25、重开面板、切换引擎、完成状态与悬浮球同步通过');

  // 另一个合成聊天中终止任务，检查未完成时同样清理旧计数并保留续传入口。
  await page.evaluate(() => {
    fixture.context.chatId = 'offline-stopped';
    WORLD_ENGINE_UI.refresh();
    document.getElementById('we-backfill-start').click();
  });
  await pending(26);
  await page.evaluate(() => document.getElementById('we-backfill-stop').click());
  await release();
  await page.waitForFunction(() => !WORLD_ENGINE_EVOLUTION.isRunning());
  assert.match(await status(), /已停止/);
  assert.equal(await count(), '');
  assert.equal(await page.$eval('#we-backfill-resume', el => el.disabled), false);

  // 世界任务在记忆面打开期间完成，切回后也不能残留旧批次。
  await page.evaluate(() => {
    fixture.context.chatId = 'offline-background-complete';
    fixture.context.chat = fixture.context.chat.slice(0, 3);
    WORLD_ENGINE_UI.refresh();
    document.getElementById('we-backfill-start').click();
  });
  await pending(27); await switchFace();
  await release();
  await page.waitForFunction(() => !WORLD_ENGINE_EVOLUTION.isRunning());
  await switchFace();
  assert.match(await status(), /更新完成，已处理到第 2 楼/);
  assert.equal(await count(), '', '后台完成后切回来不能显示旧计数');
  assert.deepEqual(failures, []); assert.deepEqual(requests, []);
  console.log('✓ 停止、续传入口、无脚本异常；无网络请求、无真实聊天文件读写');
} finally {
  await browser.close();
}
