const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'world-engine-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

console.log('Testing Header & Dual-Engine Segmented Switch (Phase 2)...');

// 1. 验证双核分段切换器 HTML 结构与属性
assert.match(ui, /class="we-segmented-switch"/, '必须包含双核分段切换器容器');
assert.match(ui, /class="we-segmented-tab we-engine-tab-world/, '必须包含世界引擎切换选项卡');
assert.match(ui, /class="we-segmented-tab we-engine-tab-memory/, '必须包含记忆引擎切换选项卡');
assert.match(ui, /data-target-face="world"/, '世界引擎必须带有 target-face 属性');
assert.match(ui, /data-target-face="memory"/, '记忆引擎必须带有 target-face 属性');

// 2. 验证状态胶囊栏结构与原有 ID 完整性
assert.match(ui, /class="we-header-status-pill"/, '必须包含状态胶囊栏容器');
assert.ok(ui.includes('id="we-header-mood"'), '必须保留心情/稳定度 ID');
assert.ok(ui.includes('class="we-header-dot"'), '必须保留心情圆点');
assert.ok(ui.includes('class="we-header-mood-text"'), '必须保留心情文本');
assert.ok(ui.includes('id="we-header-round"'), '必须保留轮数 ID');
assert.ok(ui.includes('id="we-header-story-time"'), '必须保留剧情时间 ID');
assert.ok(ui.includes('id="we-panel-version"'), '必须保留版本号 ID');

// 3. 验证事件绑定与状态更新
assert.match(ui, /panel\.querySelectorAll\('\.we-segmented-tab'\)/, '必须为分段选项卡绑定点击事件');
assert.match(ui, /switchEngineFace\(faceId\)/, '点击分段选项卡必须触发 switchEngineFace');
assert.match(ui, /worldTab\.classList\.toggle\('is-active',\s*face\.id === 'world'\)/, '必须随引擎状态同步激活态');
assert.match(ui, /e\.target\.closest\('\.we-segmented-switch'\)/, '拖拽手柄必须忽略分段切换器');

// 4. 验证 CSS 样式
assert.match(css, /\.we-segmented-switch/, 'CSS 必须包含分段切换器样式');
assert.match(css, /\.we-segmented-tab/, 'CSS 必须包含分段选项卡样式');
assert.match(css, /\.we-segmented-tab\.is-active/, 'CSS 必须包含激活态样式');
assert.match(css, /\.we-header-status-pill/, 'CSS 必须包含状态胶囊样式');

console.log('✓ 顶部 Header 现代分段切换与状态胶囊回归测试全部通过！');
