// node docs/world-story-time-ui-test.js — 执行真实面板渲染和时间保存处理器。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { harness } = require('./world-backfill-test');
const h = harness();
const api = h.sandbox.WORLD_ENGINE_TIME;
let buttons = [];
h.sandbox.document = {
  addEventListener() {}, getElementById: () => null,
  querySelectorAll: selector => selector === '.we-time-save' ? buttons : [],
  createElement: () => ({ remove() {} }), body: { appendChild() {} }
};
h.sandbox.setTimeout = () => 0;
let source = fs.readFileSync(path.join(__dirname, '../world-engine-ui.js'), 'utf8');
source = source.replace('    buildPanel, buildInputButton, showPanel, hidePanel, togglePanel, refresh, setStatus,',
  '    _test: { renderStoryClock, renderTimeInfo, renderReputation, renderEventList, bindTimeEditors },\n    buildPanel, buildInputButton, showPanel, hidePanel, togglePanel, refresh, setStatus,');
vm.runInNewContext(source, h.sandbox, { filename: 'world-engine-ui.js' });
const ui = h.sandbox.WORLD_ENGINE_UI._test;
const state = h.core.loadState();
state.events = [{ id: 'event_1', name: '测试事件', type: 'progress', level: 3, stage: '筹备', stageRound: 1 }];
api.setManualClock(state, '永明三年春', 2);
api.setManualItem(state.events[0], { occurredAt: '<script>alert(1)</script>', firstRecordedAt: '永明三年春' }, 2);
h.core.saveState(state); h.core.saveCheckpoint(state);
const html = ui.renderEventList(state.events, 'state');
assert.ok(html.includes('data-time-path="events"'));
assert.ok(html.includes('data-time-index="0"'));
assert.ok(html.includes('&lt;script&gt;'));
assert.ok(!html.includes('<script>'), '模型和用户填写的时间都应转义');
assert.ok(ui.renderStoryClock(state, 'checkpoint').includes('data-time-scope="checkpoint"'));
assert.equal((ui.renderReputation(h.core.loadState().reputation, 'state').match(/we-rep-row/g) || []).length, 4,
  '时间元数据不能被当作第五个声誉维度显示');
function save(scope, target, values, index) {
  const inputs = Object.entries(values).map(([key, value]) => ({ dataset: { timeField: key }, value }));
  const form = { dataset: { timeScope: scope, timePath: target, ...(index == null ? {} : { timeIndex: String(index) }) },
    querySelector: () => inputs[0], querySelectorAll: () => inputs };
  const button = { closest: () => form };
  buttons = [button]; ui.bindTimeEditors(); button.onclick();
}
save('checkpoint', 'events', { occurredAt: '永明二年冬' }, 0);
assert.equal(h.core.restoreCheckpoint().events[0].time.occurredAt.text, '永明二年冬');
assert.equal(h.core.loadState().events[0].time.occurredAt.text, '<script>alert(1)</script>', '存档点编辑不能改主状态');
save('state', 'storyTime', { storyTime: '永明三年夏' });
assert.equal(h.core.loadState().storyTime.text, '永明三年夏');
assert.equal(h.core.restoreCheckpoint().storyTime.text, '永明三年春');
save('state', 'events', { occurredAt: '' }, 0);
assert.equal(h.core.loadState().events[0].time.occurredAt, null, '手动清空应恢复未知');
assert.equal(h.core.loadState().events[0].time.firstRecordedAt.text, '永明三年春');
const before = h.values.get('world_engine_A');
h.sandbox.WORLD_ENGINE_EVOLUTION.isRunning = () => true;
save('state', 'storyTime', { storyTime: '不应写入' });
assert.equal(h.values.get('world_engine_A'), before, '推演期间不能用手动修正覆盖正在计算的状态');
console.log('✓ 时间面板：真实渲染、转义、声誉隔离、手动保存、主状态/存档点隔离和运行中保护通过');
