const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'world-engine-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

console.log('Testing Dashboard Category Chips & Bottom Action Bar (Phase 3 & 4)...');

// 1. 验证 DOM 结构与容器嵌入
assert.ok(ui.includes('id="we-category-chips-bar"'), '必须在面板中包含分类胶囊栏容器');
assert.ok(ui.includes('id="we-quick-action-bar"'), '必须在面板中包含底部快捷操作栏容器');

// 2. 验证世界引擎与记忆引擎分类胶囊定义
assert.match(ui, /const WORLD_CHIPS\s*=/, '必须定义世界引擎分类胶囊数据');
assert.match(ui, /id:\s*'home'[\s\S]*?id:\s*'situation'[\s\S]*?id:\s*'events'[\s\S]*?id:\s*'relations'[\s\S]*?id:\s*'resources'/, '世界引擎必须包含总览、局势、事件、关系、资源 5 大分类');

assert.match(ui, /const MEMORY_CHIPS\s*=/, '必须定义记忆引擎分类胶囊数据');
assert.match(ui, /id:\s*'home'[\s\S]*?id:\s*'people'[\s\S]*?id:\s*'entities'[\s\S]*?id:\s*'minutes'[\s\S]*?id:\s*'overview'/, '记忆引擎必须包含脉络、人物、实体、纪要、总述 5 大分类');

// 3. 验证胶囊点击切换逻辑与互斥高亮
assert.match(ui, /c\.id === activeView \? 'is-active' : ''/, '当前活跃视图胶囊必须带有 is-active 样式');
assert.match(ui, /chipsBar\.querySelectorAll\('\.we-chip-btn'\)/, '必须为所有分类胶囊绑定点击跳转事件');
assert.match(ui, /_currentView = targetView;/, '世界引擎点击胶囊必须更新 _currentView');
assert.match(ui, /_memoryView = targetView;/, '记忆引擎点击胶囊必须更新 _memoryView');

// 4. 验证核心仪表环紧凑化 (128px)
assert.match(css, /\.we-core-ring\s*\{[^}]*width:\s*128px;[^}]*height:\s*128px;/, '世界核心仪表环宽度与高度必须优化为 128px');
assert.match(css, /\.we-memory-core-ring\s*\{[^}]*width:\s*128px;[^}]*height:\s*128px;/, '记忆核心仪表环宽度与高度必须优化为 128px');
assert.match(css, /\.we-core-ring svg[\s\S]*?width:\s*100%/, '仪表环 SVG 必须自适应 100% 缩放');

// 5. 验证底部快捷操作栏按钮与事件绑定
assert.ok(ui.includes('id="we-quick-btn-forward"'), '必须包含世界引擎立即推演主按钮');
assert.ok(ui.includes('id="we-quick-btn-redo"'), '必须包含世界引擎重演当前轮按钮');
assert.ok(ui.includes('id="we-quick-btn-memory-extract"'), '必须包含记忆引擎提取记忆主按钮');
assert.ok(ui.includes('id="we-quick-btn-memory-overview"'), '必须包含记忆引擎生成总述按钮');
assert.ok(ui.includes('id="we-quick-btn-inject"'), '必须包含提示词注入状态开关按钮');
assert.ok(ui.includes('id="we-quick-btn-abort"'), '运行中必须提供停止任务快捷按钮');

// 6. 验证设置页打开时自动隐藏胶囊栏与快捷操作栏
assert.match(ui, /chipsBar\.style\.display = 'none';\s*actionBar\.style\.display = 'none';/, '进入设置页时必须隐藏分类栏与底部快捷栏');

// 7. 验证 CSS 样式类
assert.match(css, /\.we-category-chips-bar\s*\{/, 'CSS 必须包含分类胶囊栏样式');
assert.match(css, /\.we-chip-btn\s*\{/, 'CSS 必须包含胶囊按钮样式');
assert.match(css, /\.we-chip-btn\.is-active\s*\{/, 'CSS 必须包含胶囊激活态高亮样式');
assert.match(css, /\.we-quick-action-bar\s*\{/, 'CSS 必须包含底部操作栏样式');
assert.match(css, /\.act-btn-main\s*\{/, 'CSS 必须包含主操作按钮样式');
assert.match(css, /\.act-btn-sub\s*\{/, 'CSS 必须包含次操作按钮样式');
assert.match(css, /\.act-inject-switch\s*\{/, 'CSS 必须包含注入状态开关样式');
assert.match(css, /\.act-inject-switch\.is-on\s*\{/, 'CSS 必须包含注入开启高亮样式');

console.log('✓ 主界面分类导航与底部快捷操作栏（Phase 3 & 4）回归测试全部通过！');
