// node docs/world-api-routing-ui-test.js — 真实 API 配置表单、限额保存及错误展示。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { harness } = require('./world-backfill-test');
async function main() {
  const h = harness(), ids = new Map();
  let checks = [], rpmInputs = [];
  h.sandbox.setTimeout = setTimeout; h.sandbox.clearTimeout = clearTimeout;
  h.sandbox.fetch = async () => ({ ok: false, status: 503, text: async () => '<script>供应商错误</script>' });
  h.sandbox.document = { addEventListener() {}, getElementById: id => ids.get(id) || null,
    querySelectorAll(selector) {
      if (selector === '.we-api-pool-ref:checked') return checks;
      if (selector === '.we-api-connection-rpm') return rpmInputs;
      return [];
    } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../world-engine-api.js'), 'utf8'), h.sandbox);
  const api = h.sandbox.WORLD_ENGINE_API;
  const profile = api.saveApiProfile('<供应商 A>', { apiUrl: 'https://a.test', apiKey: 'key-A', model: 'model-A' });
  const ref = 'custom:' + profile.id;
  let source = fs.readFileSync(path.join(__dirname, '../world-engine-ui.js'), 'utf8');
  source = source.replace('    buildPanel, buildInputButton, showPanel, hidePanel, togglePanel, refresh, setStatus,',
    '    _test: { renderApiRoutingSettings, renderApiPoolRows, renderApiErrors, readApiConnectionForm, bindApiRoutingControls, setFace: id => { _engineFace = id; } },\n    buildPanel, buildInputButton, showPanel, hidePanel, togglePanel, refresh, setStatus,');
  vm.runInNewContext(source, h.sandbox, { filename: 'world-engine-ui.js' });
  const ui = h.sandbox.WORLD_ENGINE_UI._test;
  const form = ui.renderApiRoutingSettings({ apiPoolEnabled: true, apiPool: [ref, 'tavern:已删除'], apiRpmLimit: 2 });
  assert.ok(form.includes('&lt;供应商 A&gt;'));
  assert.ok(form.includes('tavern:已删除'));
  assert.ok(form.includes('不可用'), '失效的已选连接必须保留提示，不能悄悄消失');
  assert.ok(form.includes('id="we-api-rpm" min="0" step="1" value="2"'));
  assert.ok(ui.renderApiRoutingSettings({ apiScope: 'memory' }).includes('data-api-scope="memory"'));
  ids.set('we-api-pool-enabled', { checked: true }); ids.set('we-api-rpm', { value: '3' });
  ids.set('we-api-profile', { value: ref });
  checks = [{ dataset: { apiRef: ref } }, { dataset: { apiRef: 'tavern:b' } }];
  const world = ui.readApiConnectionForm();
  assert.equal(world.apiScope, 'world'); assert.equal(world.apiPoolEnabled, true);
  assert.deepEqual(Array.from(world.apiPool), [ref, 'tavern:b']); assert.equal(world.apiRpmLimit, 3);
  ui.setFace('memory');
  assert.equal(ui.readApiConnectionForm().apiScope, 'memory');
  const input = { dataset: { apiRef: ref }, value: '4' };
  rpmInputs = [input]; ui.bindApiRoutingControls(); input.onchange();
  assert.equal(api.getConnectionRpm(ref), 4, '单连接 RPM 应保存到连接级全局配置');
  input.value = '-9'; input.onchange(); assert.equal(api.getConnectionRpm(ref), 0);
  await assert.rejects(api.callApi('测试', 16, 0, null, { apiUrl: profile.apiUrl, apiKey: profile.apiKey, apiProfileId: profile.id }), /供应商错误/);
  const errors = ui.renderApiErrors('world');
  assert.ok(errors.includes('&lt;script&gt;供应商错误&lt;/script&gt;'));
  assert.ok(!errors.includes('<script>'), '供应商 HTML 错误必须按文本展示');
  assert.ok(errors.includes('HTTP 503'));
  assert.ok(ui.renderApiErrors('memory').includes('暂无'));
  const clear = { dataset: { apiScope: 'memory' } };
  ids.set('we-api-errors-clear', clear); ui.bindApiRoutingControls(); clear.onclick();
  assert.equal(api.getApiErrors('world').length, 1, '清理记忆报错不能清理世界报错');
  clear.dataset.apiScope = 'world'; clear.onclick(); assert.equal(api.getApiErrors().length, 0);
  console.log('✓ API 面板：多选保存、作用域、失效连接、连接 RPM、原文错误转义与分引擎清理通过');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
