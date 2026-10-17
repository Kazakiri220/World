// node docs/world-api-routing-test.js — 真实 API 层，使用可控时钟和离线传输。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function clock() {
  let now = 0, id = 0;
  const tasks = new Map();
  return {
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    setTimeout(fn, ms) { const key = ++id; tasks.set(key, { at: now + Number(ms), fn }); return key; },
    clearTimeout(key) { tasks.delete(key); },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        await flush();
        const next = [...tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; tasks.delete(next[0]); next[1].fn();
      }
      now = end; await flush();
    },
    pending: () => tasks.size
  };
}
function response(content, status = 200, headers = {}, raw = false) {
  return { ok: status >= 200 && status < 300, status, headers: { get: name => headers[name.toLowerCase()] ?? null },
    text: async () => raw ? content : JSON.stringify({ choices: [{ message: { content } }] }) };
}
function harness() {
  const timer = clock(), values = new Map(), requests = [], statuses = [];
  const tavern = { id: 'tb', name: '酒馆 B', model: 'model-B' };
  const context = { extensionSettings: { disabledExtensions: [], connectionManager: { selectedProfile: '正文连接' } },
    ConnectionManagerRequestService: {
      getSupportedProfiles: () => [tavern],
      async sendRequest(...args) { requests.push({ kind: 'B', at: timer.Date.now(), args }); return h.onTavern(...args); }
    } };
  const sandbox = { console: { log() {}, warn() {}, error() {} }, AbortController, ...timer,
    SillyTavern: { getContext: () => context },
    WORLD_ENGINE_STORE: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) },
    __WE_SetExternalStatus: text => statuses.push(text),
    async fetch(url, options) { requests.push({ kind: url.includes('a.test') ? 'A' : 'C', at: timer.Date.now(), url, options }); return h.onFetch(url, options); }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../world-engine-api.js'), 'utf8'), sandbox);
  const api = sandbox.WORLD_ENGINE_API;
  const a = api.saveApiProfile('自定义 A', { apiUrl: 'https://a.test/v1', apiKey: 'secret-A', model: 'model-A' });
  const h = { api, timer, values, requests, statuses, context, sandbox,
    a: 'custom:' + a.id, b: 'tavern:tb', aProfile: a,
    onFetch: async () => response('A'), onTavern: async () => ({ content: 'B' }) };
  h.settings = { apiScope: 'world', apiPoolEnabled: true, apiPool: [h.a, h.b], apiTimeoutMs: 1000, temperature: 0.4, maxTokens: 256 };
  h.single = { apiScope: 'world', apiPoolEnabled: false, apiProfileId: a.id, apiUrl: a.apiUrl, apiKey: a.apiKey, model: a.model, apiTimeoutMs: 1000 };
  h.call = (settings = h.settings, signal) => api.callApi('测试推演', undefined, undefined, signal, settings);
  return h;
}
async function main() {
  const rr = harness();
  for (let i = 0; i < 4; i++) assert.equal(await rr.call(), i % 2 ? 'B' : 'A');
  assert.deepEqual(rr.requests.map(row => row.kind), ['A', 'B', 'A', 'B']);
  assert.equal(JSON.parse(rr.requests[0].options.body).model, 'model-A');
  assert.equal(rr.requests[1].args[3].includePreset, false);
  assert.equal(rr.requests[1].args[4].temperature, 0.4);
  assert.equal(rr.requests[1].args[2], 256);
  assert.equal(rr.context.extensionSettings.connectionManager.selectedProfile, '正文连接');
  assert.equal(await rr.call({ ...rr.settings, apiScope: 'memory' }), 'A', '两个引擎独立轮换');
  assert.equal(await rr.call(), 'A');
  rr.values.set('world_engine_settings', JSON.stringify(rr.settings));
  await rr.call({ apiScope: 'memory', apiUrl: 'https://c.test', apiKey: 'memory-key', model: 'memory-model' });
  assert.equal(rr.requests.at(-1).kind, 'C', '显式记忆设置不能继承世界连接池');
  assert.equal(rr.requests.at(-1).options.headers.Authorization, 'Bearer memory-key');
  const concurrent = harness();
  await Promise.all(Array.from({ length: 6 }, () => concurrent.call()));
  assert.deepEqual(concurrent.requests.map(row => row.kind), ['A', 'B', 'A', 'B', 'A', 'B'], '并发申请也要原子地轮换');

  const timeout = harness();
  let late;
  timeout.onFetch = () => new Promise(resolve => { late = resolve; });
  const result = timeout.call({ ...timeout.settings, apiTimeoutMs: 10 });
  await flush(); await timeout.timer.advance(9);
  assert.equal(timeout.requests.length, 1);
  await timeout.timer.advance(1);
  assert.equal(await result, 'B', '超时后切换，即使上一条忽略 AbortSignal');
  assert.equal(timeout.requests[0].options.signal.aborted, true);
  assert.match(timeout.api.getApiErrors('world')[0].message, /超时/);
  late(response('迟到结果')); await flush();
  assert.equal(timeout.api.getRoutingStatus('world').connection, '酒馆 B');
  assert.equal(timeout.timer.pending(), 0);

  const bodyTimeout = harness();
  bodyTimeout.onFetch = async () => ({ ok: true, status: 200, text: () => new Promise(() => {}) });
  const bodyResult = bodyTimeout.call({ ...bodyTimeout.settings, apiTimeoutMs: 10 });
  await flush(); await bodyTimeout.timer.advance(10);
  assert.equal(await bodyResult, 'B', '超时涵盖响应正文读取');
  const tavernTimeout = harness();
  tavernTimeout.onTavern = () => new Promise(() => {});
  const tavernResult = tavernTimeout.call({ ...tavernTimeout.settings, apiPool: [tavernTimeout.b, tavernTimeout.a], apiTimeoutMs: 10 });
  await flush(); await tavernTimeout.timer.advance(10);
  assert.equal(await tavernResult, 'A');

  const limit = harness();
  await limit.call({ ...limit.single, apiRpmLimit: 1 });
  const waiting = limit.call({ ...limit.single, apiRpmLimit: 1, apiTimeoutMs: 1 });
  await flush();
  assert.equal(limit.api.getRoutingStatus('world').state, 'waiting');
  await limit.timer.advance(59999); assert.equal(limit.requests.length, 1);
  await limit.timer.advance(1); assert.equal(await waiting, 'A');
  assert.equal(limit.requests[1].at, 60000, '限流等待不能消耗单次请求超时');

  // 复现：原请求还需等待 27 秒时，将已保存的 RPM 从 1 改成 0。
  const liveWorld = harness();
  liveWorld.values.set('world_engine_settings', JSON.stringify({ ...liveWorld.single, apiRpmLimit: 1 }));
  await liveWorld.api.callApi('测试推演');
  await liveWorld.timer.advance(33000);
  const liveWorldWaiting = liveWorld.api.callApi('测试推演'); await flush();
  assert.match(liveWorld.api.getRoutingStatus('world').message, /27 秒/);
  liveWorld.values.set('world_engine_settings', JSON.stringify({ ...liveWorld.single, apiRpmLimit: 0 }));
  liveWorld.api.getSettings(true); // 与实际表单保存后的刷新一致，旧请求仍持有旧对象。
  await liveWorld.timer.advance(1000);
  assert.equal(liveWorld.requests.length, 2, '保存 RPM=0 必须解除正在进行的旧额度等待');
  assert.equal(await liveWorldWaiting, 'A');
  assert.equal(liveWorld.requests[1].at, 34000);
  assert.ok(!liveWorld.statuses.at(-1).includes('等待'), '恢复请求后不能继续显示旧等待横幅');
  assert.equal(liveWorld.timer.pending(), 0);

  const liveMemory = harness();
  const memorySnapshot = { ...liveMemory.single, apiScope: 'memory', apiRpmLimit: 1 };
  liveMemory.values.set('memory_engine_settings', JSON.stringify(memorySnapshot));
  await liveMemory.call(memorySnapshot);
  const liveMemoryWaiting = liveMemory.call(memorySnapshot); await flush();
  liveMemory.values.set('world_engine_settings', JSON.stringify({ apiRpmLimit: 0 }));
  await liveMemory.timer.advance(1000);
  assert.equal(liveMemory.requests.length, 1, '世界的 RPM 修改不能解除记忆的额度等待');
  liveMemory.values.set('memory_engine_settings', JSON.stringify({ ...memorySnapshot, apiRpmLimit: 0 }));
  await liveMemory.timer.advance(1000);
  assert.equal(liveMemory.requests.length, 2, '记忆请求也必须读取最新保存的 RPM');
  assert.equal(await liveMemoryWaiting, 'A');
  await liveMemory.call(memorySnapshot);
  assert.equal(liveMemory.requests.length, 3, '批量任务的旧设置快照不能重新启用旧限额');

  const raised = harness();
  raised.values.set('world_engine_settings', JSON.stringify({ ...raised.settings, apiRpmLimit: 1 }));
  await raised.api.callApi('测试推演');
  const raisedWaiting = Promise.all([raised.api.callApi('测试推演'), raised.api.callApi('测试推演')]);
  await flush(); assert.equal(raised.requests.length, 1);
  raised.values.set('world_engine_settings', JSON.stringify({ ...raised.settings, apiRpmLimit: 3 }));
  await raised.timer.advance(1000); await raisedWaiting;
  assert.deepEqual(raised.requests.map(row => row.kind), ['A', 'B', 'A'], '提高 RPM 后同步放行可用额度，仍保持轮换');
  const poolTotal = harness();
  await poolTotal.call({ ...poolTotal.settings, apiRpmLimit: 1 });
  const poolWaiting = poolTotal.call({ ...poolTotal.settings, apiRpmLimit: 1 });
  await flush(); assert.equal(poolTotal.requests.length, 1);
  await poolTotal.timer.advance(60000); assert.equal(await poolWaiting, 'B', '总 RPM 同时约束整个连接池');
  const unlimited = harness();
  for (let i = 0; i < 8; i++) await unlimited.call();
  assert.equal(unlimited.requests.length, 8, '默认 RPM 不限');

  const legacy = harness();
  legacy.values.set('world_engine_api_rpm_limits', JSON.stringify({ [legacy.a]: 1, [legacy.b]: 1 }));
  for (let i = 0; i < 6; i++) await legacy.call();
  await legacy.call({ ...legacy.single, apiScope: 'memory' });
  await legacy.call({ ...legacy.single, apiScope: 'memory' });
  assert.deepEqual(legacy.requests.map(row => row.kind), ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'A']);
  assert.ok(legacy.requests.every(row => row.at === 0), '升级后旧单连接 RPM 不得继续造成隐藏限流');
  const scopes = harness();
  await scopes.call({ ...scopes.settings, apiRpmLimit: 1 });
  await scopes.call({ ...scopes.settings, apiScope: 'memory', apiRpmLimit: 1 });
  assert.equal(scopes.requests.length, 2, '两个引擎各自的全局 RPM 互不占用');

  const cancelled = harness();
  await cancelled.call({ ...cancelled.single, apiRpmLimit: 1 });
  const controller = new AbortController();
  const cancelledResult = cancelled.call({ ...cancelled.single, apiRpmLimit: 1 }, controller.signal);
  await flush(); controller.abort();
  await assert.rejects(cancelledResult, error => error.name === 'AbortError');
  await cancelled.timer.advance(60000);
  assert.equal(cancelled.requests.length, 1, '取消等待后不得再发请求');
  assert.equal(cancelled.api.getApiErrors().length, 0, '用户取消不记供应商报错');
  assert.equal(cancelled.timer.pending(), 0);
  const preAborted = new AbortController(); preAborted.abort();
  await assert.rejects(cancelled.call(cancelled.settings, preAborted.signal), error => error.name === 'AbortError');
  assert.equal(cancelled.requests.length, 1);

  const errors = harness();
  const payload = JSON.stringify({ error: { message: 'RPM quota exhausted: secret-A', code: 'rate_limit_exceeded', request_id: 'request-123', api_key: 'secret-A' }, extra: '完整错误细节' });
  errors.onFetch = async () => response(payload, 429, { 'retry-after': '2' }, true);
  assert.equal(await errors.call(), 'B');
  const detail = errors.api.getApiErrors('world')[0];
  assert.equal(detail.status, 429); assert.ok(detail.body.includes('request-123')); assert.ok(detail.body.includes('完整错误细节'));
  assert.ok(!detail.body.includes('secret-A')); assert.ok(!detail.message.includes('secret-A'));
  assert.equal(await errors.call(), 'B');
  assert.equal(errors.requests.filter(row => row.kind === 'A').length, 1, 'Retry-After 期间不再请求这条连接');
  errors.onFetch = async () => response('恢复');
  await errors.timer.advance(2000);
  assert.equal(await errors.call(), '恢复');
  assert.equal(errors.api.getApiErrors('world').length, 1, '切换成功仍保留此前错误');
  errors.api.clearApiErrors('world'); assert.equal(errors.api.getApiErrors().length, 0);

  const cooldown = harness();
  cooldown.onFetch = async () => response(payload, 429, { 'retry-after': '30' }, true);
  const cooldownSettings = { ...cooldown.single, apiRpmLimit: 0 };
  cooldown.values.set('world_engine_settings', JSON.stringify(cooldownSettings));
  await assert.rejects(cooldown.call(cooldownSettings), /quota/);
  await cooldown.timer.advance(3000);
  cooldown.onFetch = async () => response('冷却后恢复');
  const cooldownWaiting = cooldown.call(cooldownSettings); await flush();
  const cooling = cooldown.api.getRoutingStatus('world');
  assert.equal(cooling.waitReason, 'cooldown'); assert.equal(cooling.connection, '自定义 A');
  assert.match(cooling.message, /供应商限流冷却中，约 27 秒/);
  assert.ok(!cooling.message.includes('RPM 额度'), 'RPM=0 的供应商冷却不得误报为插件额度等待');
  await cooldown.timer.advance(26999); assert.equal(cooldown.requests.length, 1);
  await cooldown.timer.advance(1); assert.equal(await cooldownWaiting, '冷却后恢复');
  assert.equal(cooldown.requests[1].at, 30000, '取消插件主动限额不能绕过供应商 Retry-After');

  const allFailed = harness();
  allFailed.onFetch = async () => response('<h1>上游故障</h1>', 503, {}, true);
  allFailed.onTavern = async () => { throw new Error('API request failed', { cause: Object.assign(new Error('原始供应商错误'), { responseText: '{"error":"权限不足"}', status: 403 }) }); };
  await assert.rejects(allFailed.call(), /连接池全部失败.*原始供应商错误/);
  assert.equal(allFailed.requests.length, 2, '每轮有限尝试，不无限循环');
  assert.equal(allFailed.api.getApiErrors().length, 2);
  assert.ok(allFailed.api.getApiErrors()[0].body.includes('权限不足'), '展开酒馆服务的 cause');
  const retry = allFailed.call({ ...allFailed.single, apiRpmLimit: 1 });
  await flush(); assert.equal(allFailed.requests.length, 2, '失败尝试也占用 RPM');
  await allFailed.timer.advance(60000);
  await assert.rejects(retry, /上游故障/);
  const removed = harness();
  assert.equal(await removed.call({ ...removed.settings, apiPool: ['custom:已删除', removed.a] }), 'A');
  assert.match(removed.api.getApiErrors()[0].message, /不可用/);
  await assert.rejects(removed.call({ ...removed.settings, apiPool: [] }), /至少勾选/);

  const applicationError = harness();
  applicationError.onFetch = async () => response('{"error":{"message":"余额不足","code":"insufficient_quota"}}', 200, {}, true);
  assert.equal(await applicationError.call(), 'B');
  assert.match(applicationError.api.getApiErrors()[0].body, /insufficient_quota/);
  const logicalRate = harness();
  logicalRate.onFetch = async () => response('{"error":{"code":"rate_limit_exceeded","message":"rate limit"}}', 200, { 'retry-after': '0' }, true);
  await logicalRate.call();
  assert.equal(logicalRate.api.getApiErrors()[0].status, 200, '业务限流不能把真实 HTTP 200 改报为 HTTP 429');
  assert.equal(logicalRate.api.getApiErrors()[0].rateLimited, true);
  const unavailableLog = harness();
  unavailableLog.onFetch = async () => response('{"error":{"message":"上游故障"}}', 503, {}, true);
  const storeWrite = unavailableLog.sandbox.WORLD_ENGINE_STORE.setItem;
  unavailableLog.sandbox.WORLD_ENGINE_STORE.setItem = (key, value) => { if (key === 'world_engine_api_errors') throw Error('存储已满'); return storeWrite(key, value); };
  assert.equal(await unavailableLog.call(), 'B', '报错记录写入失败不能阻断故障转移');
  assert.equal(unavailableLog.api.getApiErrors().length, 1);
  const stop = harness();
  stop.onFetch = () => new Promise(() => {});
  const active = new AbortController(), stopped = stop.call(stop.settings, active.signal);
  await flush(); active.abort();
  await assert.rejects(stopped, error => error.name === 'AbortError');
  assert.equal(stop.requests.length, 1, '取消当前请求后不能故障转移到下一条');
  assert.equal(stop.timer.pending(), 0);

  // 串接真实世界回填与历史：多次 HTTP 尝试只提交一份成功世界，全部失败时保留断点。
  const world = require('./world-backfill-test').harness();
  const worldClock = clock(); Object.assign(world.sandbox, worldClock, { TextEncoder });
  world.context.saveChat = () => {};
  const run = file => vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), world.sandbox, { filename: file });
  run('world-engine-api.js');
  const realApi = world.sandbox.WORLD_ENGINE_API;
  const wa = realApi.saveApiProfile('回填 A', { apiUrl: 'https://a.test', apiKey: 'key-a', model: 'model-a' });
  const wc = realApi.saveApiProfile('回填 C', { apiUrl: 'https://c.test', apiKey: 'key-c', model: 'model-c' });
  world.values.set('world_engine_settings', JSON.stringify({ ...world.settings, apiPoolEnabled: true, apiPool: ['custom:' + wa.id, 'custom:' + wc.id] }));
  let allUnavailable = false, httpCalls = 0;
  world.sandbox.fetch = async url => {
    httpCalls++;
    return url.includes('a.test') || allUnavailable ? response('{"error":{"message":"供应商暂不可用"}}', 503, {}, true)
      : response(JSON.stringify({ world_digest: '成功世界-' + httpCalls }));
  };
  run('world-engine-evolution.js'); run('world-engine-history.js');
  const realEvolution = world.sandbox.WORLD_ENGINE_EVOLUTION, realHistory = world.sandbox.WORLD_ENGINE_HISTORY;
  realHistory.init();
  let backfillResult = await realEvolution.backfillEvolve({ mode: 'rebuild', batchSize: 1, endLayer: 4 });
  assert.equal(backfillResult.done, true);
  assert.equal(httpCalls, 4); assert.equal(world.core.loadState().round, 2);
  assert.equal(realHistory.getStatus().snapshots, 2, '故障转移本身不能额外生成世界轮次或历史快照');
  const digest = world.core.loadState().worldDigest;
  const configured = JSON.parse(world.values.get('world_engine_settings'));
  world.values.set('world_engine_settings', JSON.stringify({ ...configured, apiRpmLimit: 1 })); realApi.getSettings(true);
  const paused = realEvolution.backfillEvolve({ mode: 'continue', batchSize: 1, endLayer: 6 }); await flush();
  assert.equal(realApi.getRoutingStatus('world').state, 'waiting');
  realEvolution.abort();
  assert.equal((await paused).reason, 'aborted');
  assert.equal(httpCalls, 4); assert.equal(world.core.loadState().processedThrough, 4);
  world.values.set('world_engine_settings', JSON.stringify(configured)); realApi.getSettings(true);
  allUnavailable = true;
  backfillResult = await realEvolution.backfillEvolve({ mode: 'continue', batchSize: 1, endLayer: 6 });
  assert.equal(backfillResult.done, false);
  assert.equal(world.core.loadState().processedThrough, 4);
  assert.equal(world.core.loadState().worldDigest, digest);
  assert.equal(realEvolution.getBackfillJob().nextLayer, 5);
  assert.equal(worldClock.pending(), 0);
  console.log('✓ API 轮换：混合连接、并发公平、超时与迟到丢弃、全局 RPM 即时更新、旧限额失效、取消、429 冷却区分、完整脱敏报错及有限故障转移通过');
}
const watchdog = setTimeout(() => { console.error('API 调度测试未能完成'); process.exitCode = 1; }, 5000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
