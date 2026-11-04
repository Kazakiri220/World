const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'world-engine-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

console.log('Testing Settings Redesign (Phase 1)...');

// 1. 验证世界引擎与记忆引擎选项卡结构收敛为 4 个
assert.match(ui, /const SETTINGS_TABS = \[\s*\{ key: 'conn',/, '世界引擎设置选项卡必须以 conn 开头');
assert.match(ui, /const MEMORY_SETTINGS_TABS = \[\s*\{ key: 'conn',/, '记忆引擎设置选项卡必须以 conn 开头');

for (const key of ['conn', 'evolve', 'mechanics', 'archive']) {
  assert.ok(ui.includes(`key: '${key}'`), `必须包含选项卡: ${key}`);
}

// 2. 验证即时搜索框
assert.ok(ui.includes('id="we-settings-search"'), '必须渲染世界引擎设置搜索框');
assert.ok(ui.includes('id="we-memory-settings-search"'), '必须渲染记忆引擎设置搜索框');
assert.ok(ui.includes('we-settings-search-shell'), '必须包含搜索栏样式容器');

// 3. 验证关键功能归位与 DOM ID 完整性
const requiredWorldIds = [
  'set-api',
  'set-api-retry',
  'set-evolve',
  'set-inject',
  'set-world-memory-link',
  'set-regional',
  'set-near',
  'set-distant',
  'set-dice',
  'set-winddecay',
  'set-retention',
  'set-chatcache',
  'set-backfill',
  'we-preset-manage',
  'we-save-settings',
  'we-reset-world'
];

for (const id of requiredWorldIds) {
  assert.ok(ui.includes(id), `世界引擎必须完整保留关键 DOM/Section ID: ${id}`);
}

const requiredMemoryIds = [
  'set-memory-api',
  'set-memory-retry',
  'set-memory-evolve',
  'set-memory-inject',
  'set-memory-link',
  'set-memory-mechanics',
  'set-memory-blacklist',
  'set-memory-archive',
  'set-memory-backfill',
  'we-save-memory-settings'
];

for (const id of requiredMemoryIds) {
  assert.ok(ui.includes(id), `记忆引擎必须完整保留关键 DOM/Section ID: ${id}`);
}

// 4. 验证 CSS 样式适配
assert.match(css, /\.we-settings-search-shell/, 'CSS 必须包含搜索栏样式');
assert.match(css, /\.we-settings-tabs/, 'CSS 必须包含选项卡样式');
assert.match(css, /grid-template-columns: repeat\(4, 1fr\)/, '选项卡必须采用 4 等分网格');
assert.match(css, /\.we-settings-tab-scroll \{\s*display: none !important;/, '横向滑动滚动按钮必须隐藏');

console.log('✓ 设置页 4 Tab 重组与即时搜索回归测试全部通过！');
