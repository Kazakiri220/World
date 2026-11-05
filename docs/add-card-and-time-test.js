// docs/add-card-and-time-test.js — 验证卡片添加按钮与时间和内容防重叠特性
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { harness } = require('./world-backfill-test');

const h = harness();
const api = h.sandbox.WORLD_ENGINE_TIME;

let clickHandlers = {};
h.sandbox.document = {
  addEventListener() {},
  getElementById: () => null,
  querySelectorAll: selector => {
    return (clickHandlers[selector] || []);
  },
  createElement: () => ({ remove() {} }),
  body: { appendChild() {} }
};
h.sandbox.setTimeout = () => 0;

let source = fs.readFileSync(path.join(__dirname, '../world-engine-ui.js'), 'utf8');
source = source.replace(
  '    buildPanel, buildInputButton, showPanel, hidePanel, togglePanel, refresh, setStatus,',
  '    _test: { renderStoryClock, renderTimeInfo, renderReputation, renderEventList, renderWorldTrends, renderWindList, renderFactionList, renderEnemies, renderInfluenceChain, renderWorldDigest, renderSection, bindTimeEditors },\n    buildPanel, buildInputButton, showPanel, hidePanel, togglePanel, refresh, setStatus,'
);
vm.runInNewContext(source, h.sandbox, { filename: 'world-engine-ui.js' });
const ui = h.sandbox.WORLD_ENGINE_UI._test;

console.log('Testing World Engine Card Addition & Time Layout...');

// 1. 验证各模块标题渲染 "+ 添加" 按钮
const trendSec = ui.renderSection('天下大势', 'trends', '', '大势', 'state');
assert.ok(trendSec.includes('we-section-add-btn'), '天下大势标题应包含添加按钮');
assert.ok(trendSec.includes('data-add-section="trends"'));
assert.ok(trendSec.includes('添加大势'));

const eventSec = ui.renderSection('事件链', 'events', '', '事件', 'state');
assert.ok(eventSec.includes('we-section-add-btn'), '事件链标题应包含添加按钮');
assert.ok(eventSec.includes('data-add-section="events"'));

const windSec = ui.renderSection('风声', 'winds', '', '风声', 'state');
assert.ok(windSec.includes('we-section-add-btn'), '风声标题应包含添加按钮');
assert.ok(windSec.includes('data-add-section="winds"'));

const factionSec = ui.renderSection('势力', 'factions', '', '势力', 'state');
assert.ok(factionSec.includes('we-section-add-btn'), '势力标题应包含添加按钮');
assert.ok(factionSec.includes('data-add-section="factions"'));

const enemySec = ui.renderSection('仇敌录', 'enemies', '', '仇敌', 'state');
assert.ok(enemySec.includes('we-section-add-btn'), '仇敌录标题应包含添加按钮');
assert.ok(enemySec.includes('data-add-section="enemies"'));

const infSec = ui.renderSection('影响链', 'influence', '', '影响', 'state');
assert.ok(infSec.includes('we-section-add-btn'), '影响链标题应包含添加按钮');
assert.ok(infSec.includes('data-add-section="influence"'));

// 存档点（以 cp- 开头）不应渲染添加按钮
const cpSec = ui.renderSection('天下大势', 'cp-trends', '', '大势', 'checkpoint');
assert.ok(!cpSec.includes('we-section-add-btn'), '存档点区域不应渲染添加按钮');
console.log('✓ Section title "+ 添加" buttons verified.');

// 2. 验证世界摘要标题栏编辑/添加按钮
const emptyDigest = ui.renderWorldDigest({ worldDigest: '' }, 'state');
assert.ok(emptyDigest.includes('we-digest-edit'), '摘要标题栏应包含编辑/添加按钮');
assert.ok(emptyDigest.includes('添加'), '空摘要应提示添加');
assert.ok(emptyDigest.includes('fa-plus'));

const filledDigest = ui.renderWorldDigest({ worldDigest: '天下大定。' }, 'state');
assert.ok(filledDigest.includes('we-digest-edit'));
assert.ok(filledDigest.includes('编辑'), '已有摘要应提示编辑');
assert.ok(filledDigest.includes('fa-pen'));
console.log('✓ World digest header button verified.');

// 3. 验证时钟图标加入
const clockHtml = ui.renderStoryClock({ storyTime: { text: '永明三年' } }, 'state');
assert.ok(clockHtml.includes('fa-regular fa-clock'), '剧情时间胶囊应带有时钟图标');

const itemTimeHtml = ui.renderTimeInfo({ time: { occurredAt: { text: '永明三年春' } } }, 'state', 'events', 0);
assert.ok(itemTimeHtml.includes('fa-regular fa-clock'), '卡片时间胶囊应带有时钟图标');
console.log('✓ Time capsules clock icon verified.');

// 4. 验证 CSS 防重叠规则
const css = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');

// 4a. 胶囊胶囊药丸式样
assert.ok(css.includes('.we-time-annotations > summary'), '应有 .we-time-annotations > summary 独立样式');
assert.ok(css.includes('border-radius: 12px;'), 'summary 应呈现圆角胶囊药丸状');

// 4b. 风声操作按钮上移至顶部
assert.ok(css.includes('.we-wind-item > .we-event-actions {'), '风声操作按钮应有独立规则');
assert.ok(css.includes('top: 8px;'), '风声操作按钮应置于卡片顶部右侧');

// 4c. 终局事件底部留白
assert.ok(css.includes('.we-event-item-terminal {') && css.includes('padding-bottom: 34px;'), '终局事件应留出 34px 底部空间避免遮挡时间');

// 4d. 移动端记忆行时间与内容网格行分离
assert.ok(css.includes('.we-memory-entry-time { grid-column: 1; grid-row: 1; }'), '记忆编辑器时间应位于第一行');
assert.ok(css.includes('.we-memory-entry-content { grid-column: 1; grid-row: 2; }'), '记忆编辑器内容应位于第二行，杜绝重叠');

console.log('✓ CSS layout and overlap elimination rules verified.');

console.log('\n========================================');
console.log('✓ 所有卡片添加与防重叠自动化验证全部通过！');
console.log('========================================');
