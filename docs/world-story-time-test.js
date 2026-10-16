// node docs/world-story-time-test.js — 真实合并/历史/注入，API 使用离线响应。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { harness } = require('./world-backfill-test');
const copy = value => JSON.parse(JSON.stringify(value));
const clock = (text, evidence = text) => ({ text, evidence });
const event = (id = null, extra = {}) => ({ id, name: '仓库火灾', type: 'conflict', stage: '萌芽', stageRound: 1, level: 3, desc: '正在调查起火原因', ...extra });
function load(h, file) { vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), h.sandbox, { filename: file }); }
function history(h) {
  h.sandbox.TextEncoder = TextEncoder; h.context.saveChat = () => {};
  load(h, 'world-engine-history.js'); h.sandbox.WORLD_ENGINE_HISTORY.init();
  return h.sandbox.WORLD_ENGINE_HISTORY;
}
async function main() {
  let response, sent;
  const h = harness(new Map(), { chatId: 'time', chat: [
    { is_user: false, mes: '开场' }, { is_user: true, mes: '调查' },
    { is_user: false, mes: '当前时间：1924年2月3日 09:00。得知1924年2月1日仓库起火。' }
  ] }, async prompt => { sent = prompt; return JSON.stringify(response); });
  h.sandbox.Math = Object.create(Math); h.sandbox.Math.random = () => 0.5;
  const core = h.core, time = h.sandbox.WORLD_ENGINE_TIME;
  const hist = history(h);
  core.saveState(core.loadState());
  response = { storyTime: clock('1924年2月3日 09:00'), events: [event(null, {
    time: { occurredAt: clock('1924年2月1日', '1924年2月1日仓库起火'), firstRecordedAt: '假造日期' }
  })] };
  assert.equal(await h.evo.evolve(core.loadState(), '', h.context.chat[2].mes, { mode: 'forward', targetLayer: 2 }), true);
  let state = core.loadState(); h.sandbox.WORLD_ENGINE_LEDGER.recordChanges(state); hist.commit(state);
  assert.equal(h.calls(), 1, '时间提取与世界更新合用同一次 API');
  assert.match(sent, /剧情时间标注/);
  assert.equal(state.storyTime.sourceLayer, 2);
  assert.equal(state.events[0].time.occurredAt.text, '1924年2月1日');
  assert.equal(state.events[0].time.firstRecordedAt.text, '1924年2月3日 09:00');
  assert.equal(state.memories[0].storyTime.text, '1924年2月3日 09:00');
  assert.equal(state.memories[0].changes[0].time.occurredAt.text, '1924年2月1日');
  const first = copy(state.events[0].time);
  h.context.chat.push({ is_user: true, mes: '继续' }, { is_user: false, mes: '当前时间：1924年2月3日 10:00。继续交谈。' });
  response = { storyTime: clock('1924年2月3日 10:00'), events: [event('event_1', {
    name: '仓库失火调查', desc: '火灾成因仍在调查中', time: { changed: false, firstRecordedAt: '覆盖攻击' }
  })] };
  assert.equal(await h.evo.evolve(core.loadState(), '', h.context.chat[4].mes, { mode: 'forward', targetLayer: 4 }), true);
  state = core.loadState(); hist.commit(state);
  assert.deepEqual(copy(state.events[0].time), first, '改名、改写或重复读取不刷新时间，也不能覆盖首次记录');
  assert.ok(sent.includes('1924年2月1日'), '旧时间必须进入后续推演输入');

  h.context.chat.push({ is_user: true, mes: '继续调查' }, { is_user: false, mes: '当前时间：1924年2月4日。查到有人纵火，1924年2月5日开庭。' });
  response = { storyTime: clock('1924年2月4日'), events: [event('event_1', {
    stage: '发酵', desc: '纵火线索引发追查', time: { changed: true, expectedAt: clock('1924年2月5日', '1924年2月5日开庭') }
  })] };
  await h.evo.evolve(core.loadState(), '', h.context.chat[6].mes, { mode: 'forward', targetLayer: 6 });
  state = core.loadState(); h.sandbox.WORLD_ENGINE_LEDGER.recordChanges(state); hist.commit(state);
  assert.equal(state.events[0].time.firstRecordedAt.text, first.firstRecordedAt.text);
  assert.equal(state.events[0].time.lastChangedAt.text, '1924年2月4日');
  assert.equal(state.events[0].time.expectedAt.text, '1924年2月5日');
  assert.equal(state.events[0].time.occurredAt.text, '1924年2月1日');
  assert.equal('changed' in state.events[0].time, false, '临时语义变化标记不落盘');
  assert.ok(!JSON.stringify(state.lastEvolveResult).includes('"changed":'), '持久化的推演结果和记忆联动也不能携带临时标记');
  assert.equal(state.memories[0].changes[0].time.lastChangedAt.text, '1924年2月4日');

  load(h, 'world-engine-inject.js');
  const injection = h.sandbox.WORLD_ENGINE_INJECT.buildContext(state);
  assert.ok(injection.includes('剧情时间：1924年2月4日'));
  assert.ok(injection.includes('发生：1924年2月1日'));
  assert.ok(injection.includes('预计／截止：1924年2月5日'));
  assert.match(h.sandbox.WORLD_ENGINE_LEDGER.buildLedgerText(state), /剧情时间：1924年2月4日/);

  const parent = copy(h.context.chat);
  const branch = harness(h.values, { chatId: 'branch', chat: copy(parent.slice(0, 5)) });
  history(branch);
  assert.equal(branch.core.loadState().storyTime.text, '1924年2月3日 10:00', '原生分支取分支位置的剧情时间');
  assert.equal(branch.core.loadState().events[0].time.lastChangedAt.text, first.lastChangedAt.text);
  h.context.chat.length = 3; hist.sync();
  assert.equal(core.loadState().storyTime.text, '1924年2月3日 09:00', '删除回退同时恢复世界时钟和条目时间');
  assert.equal(core.loadState().events[0].time.expectedAt, null);

  // 本地时间合并边界：无日期、模型无依据返回、沿用、人工更正及旧存档。
  const baseline = core.loadState();
  const inherited = copy(baseline);
  inherited.events[0].desc = '新的线索';
  time.apply(inherited, baseline, { storyTime: clock('2099年1月1日', '不存在的证据'),
    events: [{ id: 'event_1', time: { changed: true, occurredAt: clock('2099年1月1日', '不存在的证据') } }] },
    { text: '发现新的线索', layer: 4, previous: baseline.storyTime });
  assert.equal(inherited.storyTime.text, baseline.storyTime.text);
  assert.equal(inherited.storyTime.source, 'inherited');
  assert.equal(inherited.events[0].time.lastChangedAt.source, 'inherited');
  assert.equal(inherited.events[0].time.occurredAt.text, first.occurredAt.text);

  const legacy = core.getDefaultState(); legacy.events = [event('event_1')];
  time.normalizeState(legacy);
  assert.equal(legacy.storyTime, null);
  assert.equal(legacy.events[0].time.firstRecordedAt, null);
  const upgraded = copy(legacy);
  time.apply(upgraded, legacy, { storyTime: clock('永明三年春') }, { text: '当前时间：永明三年春', layer: 8, previous: null });
  assert.equal(upgraded.events[0].time.firstRecordedAt, null, '旧条目不伪造首次记录日期');
  assert.equal(upgraded.events[0].time.lastChangedAt, null);
  assert.equal(upgraded.storyTime.text, '永明三年春', '虚构纪年及不完整日期保留原精度');
  time.setManualItem(upgraded.events[0], { occurredAt: '永明二年冬' }, 8);
  const edited = copy(upgraded);
  time.apply(edited, upgraded, { events: [{ id: 'event_1', time: { occurredAt: clock('永明三年春') } }] },
    { text: '永明三年春', layer: 10, previous: upgraded.storyTime });
  assert.equal(edited.events[0].time.occurredAt.text, '永明二年冬', '模型不能覆盖手动修正的事实时间');
  time.setManualClock(edited, '永明三年暮春', 10);
  assert.equal(edited.storyTime.source, 'manual');
  const unknown = core.getDefaultState();
  unknown.events = [event()];
  time.apply(unknown, core.getDefaultState(), {}, { text: '没有时间的正文', layer: 2, previous: null });
  assert.equal(unknown.storyTime, null);
  assert.equal(unknown.events[0].time.firstRecordedAt, null);

  const sameName = copy(baseline);
  sameName.events.push(event('event_2'));
  time.apply(sameName, baseline, { storyTime: clock('1924年2月8日') },
    { text: '1924年2月8日', layer: 8, previous: baseline.storyTime });
  assert.equal(sameName.events[1].time.firstRecordedAt.text, '1924年2月8日', '不同 ID 的同名新事件不能继承旧事件的首次记录时间');

  // 合并批次只看到目标范围正文，失败后的续传不会把聊天末尾日期填入历史。
  const seen = [];
  let requests = 0;
  const backfill = harness(new Map(), { chatId: 'historical', chat: [
    { is_user: false, mes: '开场' }, { is_user: true, mes: '继续' }, { is_user: false, mes: '当前时间：春月初一。' },
    { is_user: true, mes: '继续' }, { is_user: false, mes: '当前时间：春月初二。' },
    { is_user: true, mes: '继续' }, { is_user: false, mes: '当前时间：秋月初一。' }
  ] }, async prompt => {
    const recent = prompt.split('## 近期对话\n')[1].split('\n\n')[0];
    seen.push(recent); requests++;
    if (requests === 2) throw Error('断线');
    const date = recent.match(/当前时间：([^。]+)/g).pop().slice(5);
    return JSON.stringify({ world_digest: '历史更新', storyTime: clock(date) });
  });
  history(backfill);
  let result = await backfill.evo.backfillEvolve({ mode: 'rebuild', batchSize: 1, endLayer: 4 });
  assert.equal(result.done, false);
  assert.equal(backfill.core.loadState().storyTime.text, '春月初一');
  assert.ok(seen.every(recent => !recent.includes('秋月初一')), '回填不向模型泄露结束楼层之后的正文时间');
  result = await backfill.evo.backfillEvolve({ mode: 'resume' });
  assert.equal(result.done, true);
  assert.equal(backfill.core.loadState().storyTime.text, '春月初二');
  assert.equal(backfill.core.loadState().storyTime.sourceLayer, 4);
  assert.equal(backfill.calls(), 3);
  await backfill.evo.backfillEvolve({ mode: 'rebuild', batchSize: 2, endLayer: 4 });
  assert.equal(backfill.core.loadState().storyTime.text, '春月初二', '合并批次以本段末尾场景时间标注状态');
  assert.equal(backfill.core.loadState().storyTime.sourceLayer, 4);
  const terminal = harness(new Map(), { chatId: 'terminal', chat: [
    { is_user: false, mes: '开场' }, { is_user: true, mes: '继续' }, { is_user: false, mes: '当前时间：永明三年夏。计划已取消。' }
  ] }, async () => JSON.stringify({ storyTime: clock('永明三年夏'), events: [event('event_1', { type: 'progress', stage: '已失败', level: 1 })] }));
  const active = terminal.core.loadState();
  active.events = [event('event_1', { type: 'progress', stage: '筹备', level: 1 })];
  terminal.core.saveState(active);
  await terminal.evo.evolve(terminal.core.loadState(), '', terminal.context.chat[2].mes, { mode: 'forward', targetLayer: 2 });
  const completed = terminal.core.loadState();
  terminal.sandbox.WORLD_ENGINE_LEDGER.recordChanges(completed);
  assert.equal(completed.events.length, 0);
  assert.equal(completed.memories[0].changes[0].time.lastChangedAt.text, '永明三年夏', '本轮立刻清退的终局事件，其变化时间仍须进入账本');

  const legacyStrings = terminal.core.loadState();
  legacyStrings.blackbox = { secretActions: ['旧的隐秘行为'], secretAssets: ['旧的秘密资产'] };
  legacyStrings.economy.signals = ['旧的市场信号'];
  terminal.core.saveState(legacyStrings);
  const normalized = terminal.core.loadState();
  assert.equal(normalized.blackbox.secretActions[0].action, '旧的隐秘行为');
  assert.equal(normalized.blackbox.secretAssets[0].time.firstRecordedAt, null);
  assert.equal(normalized.economy.signals[0].summary, '旧的市场信号');
  console.log('✓ 剧情时间：延迟获知、首次记录、语义变化、证据验证、旧存档、人工修正、注入、账本、分支与回退通过');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
