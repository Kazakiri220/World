// node docs/world-history-lifecycle-test.js — 真实主入口与历史模块事件联调，无酒馆文件写入。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { harness } = require('./world-backfill-test');
async function main() {
  const h = harness(new Map(), { chatId: 'lifecycle', chat: [
    { is_user: false, mes: '开场' }, { is_user: true, mes: '用户' }, { is_user: false, mes: '回复' }
  ] });
  h.allowAll(); h.settings.historyRetentionLayers = 200;
  const listeners = new Map(), injected = new Map(), sandbox = h.sandbox;
  h.context.event_types = { CHAT_LOADED: 'chatLoaded', GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', MESSAGE_SWIPED: 'message_swiped', MESSAGE_DELETED: 'message_deleted' };
  h.context.eventSource = { on(name, handler) { const list = listeners.get(name) || []; list.push(handler); listeners.set(name, list); } };
  h.context.saveChat = () => {};
  h.context.setExtensionPrompt = (key, text) => injected.set(key, text);
  const emit = async (name, ...args) => { for (const handler of listeners.get(name) || []) await handler(...args); };
  sandbox.TextEncoder = TextEncoder; sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = () => 0; sandbox.fetch = async () => ({ ok: false });
  sandbox.WORLD_ENGINE_STORE.hydrate = async () => {};
  const stubs = {
    'world-engine-worldbook.js': ['WORLD_ENGINE_WORLDBOOK', { buildPromptSection: async () => '' }],
    'world-engine-chatcache.js': ['WORLD_ENGINE_CHATCACHE', { init() {} }],
    'world-engine-inject-inspector.js': ['WORLD_ENGINE_INJECT_INSPECTOR', { init() {} }],
    'world-engine-preset.js': ['WORLD_ENGINE_PRESET', { getActivePreset: () => null }],
    'world-engine-rules-loader.js': ['WORLD_ENGINE_RULES', { loadRules: async () => ({ count: 0 }), getAllRulesText: () => '', getCoreRulesSummary: () => '' }],
    'world-engine-inject.js': ['WORLD_ENGINE_INJECT', { buildContext: state => state.worldDigest }],
    'world-engine-ui.js': ['WORLD_ENGINE_UI', { buildPanel() {}, buildInputButton() {}, refresh() {}, setEvolvingUI() {}, setInjectedScope() {} }],
    'world-engine-diag.js': ['WORLD_ENGINE_DIAG', { collect: () => ({}), download() {} }],
    'memory-engine-settings.js': ['MEMORY_ENGINE_SETTINGS', { getSettings: () => ({ engineEnabled: false }), patchSettings() {} }],
    'memory-engine-data.js': ['MEMORY_ENGINE_DATA', { loadState: () => ({}), saveState() {} }],
    'memory-engine-timeline.js': ['MEMORY_ENGINE_TIMELINE', { captureRange: () => [], auditRefs: () => ({}), syncHidden() {} }],
    'memory-engine-prompt.js': ['MEMORY_ENGINE_PROMPT', { buildUserPrompt: () => '' }],
    'memory-engine-small-summary-prompt.js': ['MEMORY_ENGINE_SMALL_SUMMARY_PROMPT', { buildUserPrompt: () => '' }],
    'memory-engine-big-summary-prompt.js': ['MEMORY_ENGINE_BIG_SUMMARY_PROMPT', { buildUserPrompt: () => '' }],
    'memory-engine.js': ['MEMORY_ENGINE', { init() {}, applyInjection() {}, abort() {}, isRunning: () => false }]
  };
  const context = vm.createContext(sandbox);
  const run = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  sandbox.document = { readyState: 'complete', getElementById: () => null,
    getElementsByTagName: () => [{ src: 'https://example.test/world-engine.js' }], createElement: () => ({}),
    head: { appendChild(script) {
      const file = script.src.split('/').pop();
      if (stubs[file]) { const [key, value] = stubs[file]; sandbox[key] = value; }
      else if (!['world-engine-store.js', 'world-engine-api.js'].includes(file)) run(file);
      queueMicrotask(() => script.onload());
    } }
  };
  run('world-engine.js');
  for (let i = 0; i < 30 && !sandbox.WORLD_ENGINE; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(sandbox.WORLD_ENGINE, '主入口应成功初始化');
  const core = sandbox.WORLD_ENGINE_CORE;
  await sandbox.WORLD_ENGINE.manualEvolve('forward');
  const first = core.loadState().worldDigest;
  await emit('generation_started', 'normal', {}, false);
  h.context.chat.push({ is_user: true, mes: '用户2' }, { is_user: false, mes: '回复2' });
  await sandbox.WORLD_ENGINE.manualEvolve('forward');
  assert.equal(core.loadState().round, 2);
  await emit('generation_started', 'regenerate', {}, false);
  assert.equal(injected.get('world-engine-world'), first, '重生成前应注入上一状态，而非再退一轮');
  h.context.chat[4] = { is_user: false, mes: '重新生成的回复2' };
  await sandbox.WORLD_ENGINE.manualEvolve('forward');
  assert.equal(core.loadState().round, 2, '重生成完成后应保持该楼的世界轮次');
  h.context.chat.length = 3; await emit('message_deleted', 3);
  assert.equal(core.loadState().worldDigest, first);
  assert.equal(injected.get('world-engine-world'), first, '删除事件应立即刷新注入');
  assert.equal(listeners.has('message_edited'), false, '世界模块不得监听正文编辑来更新世界');
  let resolveApi, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  sandbox.WORLD_ENGINE_API.callApi = async () => { entered(); return new Promise(resolve => { resolveApi = resolve; }); };
  h.context.chat.push({ is_user: true, mes: '用户3' }, { is_user: false, mes: '回复3' });
  const pending = sandbox.WORLD_ENGINE.manualEvolve('forward'); await ready;
  h.context.chat.length = 3; await emit('message_deleted', 3);
  resolveApi('{"world_digest":"不应落盘的迟到结果"}');
  assert.equal(await pending, false);
  assert.equal(core.loadState().worldDigest, first);
  console.log('✓ 主入口事件联调：重生成基底、轮次、删除注入和迟到响应测试通过');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
