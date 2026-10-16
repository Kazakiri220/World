// node docs/world-backfill-test.js — 使用真实 core/evolution，API 以离线响应替代。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
function harness(values = new Map(), context = null, request = null) {
  context ||= { chatId: 'A', chat: Array.from({ length: 13 }, (_, i) => ({ is_user: i % 2 === 1, mes: '正文-' + i })) };
  let calls = 0, failAt = 2;
  const settings = { firstLayerIsAiOpening: true, backfillBatchSize: 2, backfillRetries: 0,
    localRegionalIncidentChancePercent: 0, localDistantEventChancePercent: 0, localNearEventChancePercent: 0 };
  const sandbox = { console: { log() {}, warn() {}, error() {} }, AbortController,
    SillyTavern: { getContext: () => context },
    WORLD_ENGINE_STORE: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) },
    WORLD_ENGINE_API: { getSettings: () => settings, parseJSON: JSON.parse, callApi: async (...args) => {
      calls++; if (request) return request(...args);
      if (calls === failAt) throw Error('模拟断网');
      return JSON.stringify({ world_digest: '更新-' + calls });
    } }
  };
  sandbox.window = sandbox;
  const run = file => vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, { filename: file });
  run('world-engine-core.js'); run('world-engine-time.js'); run('world-engine-ledger.js'); run('world-engine-evolution.js');
  return { sandbox, values, context, settings, core: sandbox.WORLD_ENGINE_CORE, evo: sandbox.WORLD_ENGINE_EVOLUTION,
    allowAll: () => { failAt = -1; }, calls: () => calls };
}
async function main() {
  const a = harness();
  let result = await a.evo.backfillEvolve({ mode: 'rebuild', endLayer: 6 });
  assert.equal(result.done, false); assert.equal(result.reason, 'evolve-failed');
  assert.equal(a.core.loadState().processedThrough, 4, '批次结束楼层不能被标成聊天末尾 12');
  assert.equal(a.core.loadState().round, 1);
  assert.equal(a.evo.getBackfillJob().nextLayer, 5);
  const reload = harness(a.values, a.context); reload.allowAll();
  result = await reload.evo.backfillEvolve({ mode: 'resume' });
  assert.equal(result.done, true); assert.equal(reload.calls(), 1, '刷新后仅重试未完成批次');
  assert.equal(reload.core.loadState().processedThrough, 6);
  assert.equal(reload.core.loadState().round, 2);
  result = await reload.evo.backfillEvolve({ mode: 'continue', layerCount: 4 });
  assert.equal(result.done, true); assert.equal(result.processedThrough, 10, '数量按聊天楼层而非 AI 轮次数计算');
  assert.equal(reload.core.loadState().round, 3);
  const before = reload.values.get('world_engine_A');
  result = await reload.evo.backfillEvolve({ mode: 'continue', endLayer: 8 });
  assert.equal(result.reason, 'no-ai-layers'); assert.equal(reload.values.get('world_engine_A'), before);

  let resolveApi, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const b = harness(new Map(), null, async () => { entered(); return new Promise(resolve => { resolveApi = resolve; }); });
  const pending = b.evo.backfillEvolve({ mode: 'rebuild', endLayer: 2 });
  await ready;
  b.values.set('world_engine_B', JSON.stringify({ round: 99, worldDigest: '另一个聊天' }));
  const other = b.values.get('world_engine_B');
  b.context.chatId = 'B'; b.evo.abort(); resolveApi('{"world_digest":"迟到结果"}');
  result = await pending;
  assert.equal(result.done, false); assert.equal(b.values.get('world_engine_B'), other, '切聊天后的响应及错误恢复均不得写入新聊天');
  assert.equal(b.values.has('world_engine_B_checkpoint'), false);
  console.log('✓ 范围楼层、失败保留、刷新续传、数量限制、切聊天迟到响应测试通过');
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { harness };
