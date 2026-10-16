// node docs/world-history-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { harness } = require('./world-backfill-test');
const copy = value => JSON.parse(JSON.stringify(value));
function withHistory(values, context, limit = 200) {
  const h = harness(values, context); h.allowAll();
  h.settings.historyRetentionLayers = limit;
  h.sandbox.TextEncoder = TextEncoder;
  h.context.saveChat = () => {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../world-engine-history.js'), 'utf8'), h.sandbox);
  h.history = h.sandbox.WORLD_ENGINE_HISTORY;
  h.history.init();
  return h;
}
async function main() {
  const a = withHistory();
  a.values.set('world_engine_worldbook_selection_A', '{"ids":["book-entry"]}');
  a.core.saveState(a.core.loadState());
  assert.equal(a.context.chat[0].world_engine_history_root.pack.worldbook, '{"ids":["book-entry"]}', '首次更新前的世界书选择也应保留在基底');
  a.context.chat[2].TavernDB_ACU_IsolatedData = { database: '原数据库字段' };
  a.context.chat[2].extra.otherPlugin = { untouched: true };
  let result = await a.evo.backfillEvolve({ mode: 'rebuild', batchSize: 1, endLayer: 10 });
  assert.equal(result.done, true);
  assert.equal(a.history.getStatus().snapshots, 5);
  const at10 = a.core.loadState().worldDigest;
  a.context.chat[4].mes = '用户手动编辑了正文';
  const calls = a.calls(); a.history.sync();
  assert.equal(a.calls(), calls, '正文编辑不调用 API');
  assert.equal(a.core.loadState().worldDigest, at10, '正文编辑后加载聊天也不作废世界历史');

  const parent = copy(a.context.chat), parentRoot = JSON.stringify(parent[0].world_engine_history_root);
  const other = { chatId: 'B', chat: copy(parent.slice(0, 7)) };
  // 模拟原生分支继承了主线最新 live，本插件必须优先使用截取后的消息历史。
  a.values.set('world_engine_B', a.values.get('world_engine_A'));
  const b = withHistory(a.values, other);
  assert.equal(b.core.loadState().processedThrough, 6);
  assert.equal(b.core.loadState().worldDigest, '更新-3');
  assert.equal(JSON.stringify(a.context.chat[0].world_engine_history_root), parentRoot, '分支不能改主线根');
  b.context.chat.push({ is_user: true, mes: '分支用户' }, { is_user: false, mes: '分支回复' });
  result = await b.evo.backfillEvolve({ mode: 'continue', batchSize: 1 });
  assert.equal(result.done, true);
  assert.equal(JSON.parse(a.values.get('world_engine_A')).worldDigest, at10, '分支推进不改主线状态');

  a.context.chat.length = 8; a.history.sync();
  assert.equal(a.core.loadState().processedThrough, 6);
  assert.equal(a.core.loadState().worldDigest, '更新-3');
  assert.equal(a.calls(), calls, '删除回退不请求 API');
  assert.equal(a.context.chat[2].TavernDB_ACU_IsolatedData.database, '原数据库字段');
  assert.equal(a.context.chat[2].extra.otherPlugin.untouched, true);

  const shortContext = { chatId: 'swipes', chat: [{ is_user: false, mes: '开场' }, { is_user: true, mes: '问题' }, { is_user: false, mes: '回答 A' }] };
  const s = withHistory(new Map(), shortContext);
  await s.evo.backfillEvolve({ mode: 'rebuild', batchSize: 1 });
  const original = s.core.loadState().worldDigest, message = s.context.chat[2];
  message.swipes = ['回答 A', '回答 B'];
  message.swipe_info = [{ extra: copy(message.extra) }, { extra: {} }];
  message.swipe_id = 1; message.extra = {}; message.mes = '回答 B'; s.history.sync();
  assert.equal(s.core.loadState().round, 0, '没有快照的新回复版本应先恢复基底');
  await s.evo.evolve(s.core.loadState(), '', message.mes, { mode: 'forward', targetLayer: 2 });
  s.sandbox.WORLD_ENGINE_LEDGER.recordChanges(s.core.loadState());
  const alternative = s.core.loadState().worldDigest;
  assert.notEqual(original, alternative);
  message.swipe_id = 0; message.extra = copy(message.swipe_info[0].extra); message.mes = '回答 A'; s.history.sync();
  assert.equal(s.core.loadState().worldDigest, original);
  message.swipe_id = 1; message.extra = copy(message.swipe_info[1].extra); message.mes = '回答 B'; s.history.sync();
  assert.equal(s.core.loadState().worldDigest, alternative);
  // 删除早先 swipe 后，下标移动，稳定的版本 ID 仍能定位原状态。
  message.swipes.shift(); message.swipe_info.shift(); message.swipe_id = 0; s.history.sync();
  assert.equal(s.core.loadState().worldDigest, alternative);

  const capped = withHistory(undefined, undefined, 4);
  await capped.evo.backfillEvolve({ mode: 'rebuild', batchSize: 1 });
  assert.equal(capped.history.getStatus().earliestLayer, 9);
  assert.equal(capped.history.getStatus().snapshots, 2, '最近四层只有第10/12楼发生更新');
  assert.equal(capped.history.restoreToLayer(10).ok, true, '清理旧差分后仍可精确恢复保留状态');
  assert.equal(capped.core.loadState().worldDigest, '更新-5');
  assert.equal(capped.history.restoreToLayer(8).reason, 'history-pruned');
  capped.context.chat.length = 9; capped.history.sync();
  assert.equal(capped.history.isBlocked(), true, '超出保留范围时不得注入未来世界');

  const range = withHistory();
  await range.evo.backfillEvolve({ mode: 'rebuild', batchSize: 1, endLayer: 10 });
  result = await range.evo.backfillEvolve({ mode: 'range', startLayer: 5, endLayer: 8, batchSize: 1 });
  assert.equal(result.done, true); assert.equal(range.core.loadState().processedThrough, 8);
  const branchAtOldEnd = withHistory(range.values, { chatId: 'after-range', chat: copy(range.context.chat) });
  assert.equal(branchAtOldEnd.core.loadState().processedThrough, 8, '范围重算后不应复活第10楼的旧世界');

  const batch = withHistory();
  await batch.evo.backfillEvolve({ mode: 'rebuild', batchSize: 2, endLayer: 8 });
  assert.equal(batch.history.restoreToLayer(6, { range: true }).reason, 'batch-boundary');

  // API 已提交，但账本/历史提交前刷新：利用待提交标记补全历史，不再次调用 API。
  const recovery = withHistory(new Map(), copy(shortContext));
  recovery.history.beginRebuild();
  await recovery.evo.evolve(recovery.core.loadState(), '', '回复', { mode: 'forward', targetLayer: 2 });
  const recoveredDigest = recovery.core.loadState().worldDigest;
  assert.ok(recovery.core.loadState()._historyPending);
  const reopened = withHistory(recovery.values, copy(recovery.context));
  assert.equal(reopened.core.loadState().worldDigest, recoveredDigest);
  assert.equal(reopened.history.getStatus().snapshots, 1);
  assert.equal(reopened.calls(), 0);

  const complex = withHistory();
  const rich = complex.core.loadState();
  rich.events = [{ name: '事件', type: 'progress', stage: '筹备', level: 2, desc: '最初描述' }];
  rich.economy = { climate: '平稳', signals: [{ summary: '原信号', scope: '区域' }] };
  rich.customFlag = { original: true };
  complex.core.saveStateWithLayer(rich, 2);
  const changed = complex.core.loadState(); changed.events = []; delete changed.customFlag;
  changed.economy = { climate: '繁荣', signals: [] }; changed.blackbox.secretActions = [{ summary: '秘密' }];
  complex.core.saveStateWithLayer(changed, 4);
  complex.history.restoreToLayer(2);
  assert.equal(complex.core.loadState().events.length, 1);
  assert.equal(complex.core.loadState().economy.signals.length, 1);
  assert.equal(complex.core.loadState().customFlag.original, true);
  complex.history.restoreToLayer(4);
  assert.equal(complex.core.loadState().events.length, 0);
  assert.equal(complex.core.loadState().economy.climate, '繁荣');
  assert.equal(complex.core.loadState().customFlag, undefined);
  assert.equal(complex.core.loadState().blackbox.secretActions.length, 1);

  const longContext = { chatId: 'long', chat: Array.from({ length: 43 }, (_, i) => ({ is_user: i % 2 === 1, mes: '正文' + i })) };
  const long = withHistory(new Map(), longContext);
  await long.evo.backfillEvolve({ mode: 'rebuild', batchSize: 1 });
  const twentieth = Object.values(long.context.chat[40].world_engine_history.versions)[0];
  assert.ok(twentieth.full, '每20份记录建立独立完整快照');
  assert.ok(Object.values(long.context.chat[42].world_engine_history.versions)[0].patch, '中间更新保留差分');
  long.history.restoreToLayer(40);
  assert.equal(long.core.loadState().worldDigest, '更新-20');

  const disabled = harness(); disabled.settings.engineEnabled = false;
  disabled.sandbox.TextEncoder = TextEncoder;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../world-engine-history.js'), 'utf8'), disabled.sandbox);
  disabled.sandbox.WORLD_ENGINE_HISTORY.init();
  assert.equal(disabled.context.chat[0].world_engine_history_root, undefined, '世界关闭时不建立历史或空世界');
  assert.equal(disabled.values.has('world_engine_A'), false);
  console.log('✓ 世界历史：编辑不触发、删除回退、分支隔离、swipe版本、保留上限、范围重算与批次边界测试通过');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
