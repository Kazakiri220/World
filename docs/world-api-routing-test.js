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
  const poolTotal = harness();
  await poolTotal.call({ ...poolTotal.settings, apiRpmLimit: 1 });
  const poolWaiting = poolTotal.call({ ...poolTotal.settings, apiRpmLimit: 1 });
  await flush(); assert.equal(poolTotal.requests.length, 1);
  await poolTotal.timer.advance(60000); assert.equal(await poolWaiting, 'B', '总 RPM 同时约束整个连接池');
  const unlimited = harness();
  for (let i = 0; i < 8; i++) await unlimited.call();
  assert.equal(unlimited.requests.length, 8, '默认 RPM 不限');

  const perConnection = harness();
  perConnection.api.setConnectionRpm(perConnection.a, 1);
  await perConnection.call(); await perConnection.call(); await perConnection.call();
  assert.deepEqual(perConnection.requests.map(row => row.kind), ['A', 'B', 'B'], '有空闲连接时跳过暂时耗尽额度的连接');
  const saturated = harness();
  saturated.api.setConnectionRpm(saturated.a, 1); saturated.api.setConnectionRpm(saturated.b, 1);
  await saturated.call(); await saturated.call();
  const saturatedWait = saturated.call(); await flush();
  assert.equal(saturated.requests.length, 2);
  await saturated.timer.advance(60000); assert.equal(await saturatedWait, 'A', '所有连接都到上限时等待最早恢复的额度');
  const shared = harness();
  shared.api.setConnectionRpm(shared.a, 1);
  await shared.call(shared.single);
  const memory = shared.call({ ...shared.single, apiScope: 'memory' });
  await flush(); assert.equal(shared.requests.length, 1);
  await shared.timer.advance(60000); await memory;
  assert.equal(shared.requests.length, 2, '同一连接跨引擎共用 RPM 计数');
  const aliases = harness();
  const alias = aliases.api.saveApiProfile('A 的另一个名字', aliases.aProfile);
  aliases.api.setConnectionRpm(aliases.a, 1);
  const aliasSettings = { ...aliases.settings, apiPool: [aliases.a, 'custom:' + alias.id] };
  await aliases.call(aliasSettings);
  const aliasPending = aliases.call(aliasSettings); await flush();
  assert.equal(aliases.requests.length, 1, '同地址同密钥别名不能绕过限额');
  await aliases.timer.advance(60000); await aliasPending;

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
  console.log('✓ API 轮换：混合连接、并发公平、超时与迟到丢弃、RPM/别名/跨引擎、取消、429 冷却、完整脱敏报错及有限故障转移通过');
}
const watchdog = setTimeout(() => { console.error('API 调度测试未能完成'); process.exitCode = 1; }, 5000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
