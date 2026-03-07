const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../web/public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../web/public/styles.css'), 'utf8');

test('前端页面内置统一 SVG 图标系统并在导航/面板中使用', () => {
  assert.match(html, /<svg[^>]*class="svg-sprite"/);
  assert.match(html, /<symbol id="icon-dashboard"/);
  assert.match(html, /<symbol id="icon-settings"/);
  assert.match(html, /<symbol id="icon-bag"/);
  assert.match(html, /<symbol id="icon-gift"/);
  assert.match(html, /<symbol id="icon-bell"/);
  assert.match(html, /<symbol id="icon-log"/);
  assert.match(html, /<svg class="ui-icon"[^>]*><use href="#icon-dashboard"/);
  assert.match(html, /<svg class="ui-icon"[^>]*><use href="#icon-settings"/);
});

test('总览页包含异常监控卡与推荐动作位', () => {
  assert.match(html, /id="overviewAlertCount"/);
  assert.match(html, /id="overviewKickoutCount"/);
  assert.match(html, /id="overviewWsCloseCount"/);
  assert.match(html, /id="overviewWarnErrorCount"/);
  assert.match(html, /id="overviewAlertSummary"/);
});

test('浅色主题补齐高对比卡片与状态控件样式', () => {
  assert.match(css, /body\[data-theme="light"\]\s*\{[\s\S]*--text-main:\s*#132235;/);
  assert.match(css, /body\[data-theme="light"\][\s\S]*--border-soft:\s*rgba\(62, 106, 162, 0\.14\)/);
  assert.match(css, /body\[data-theme="light"\]\s+\.status-chip/);
  assert.match(css, /body\[data-theme="light"\]\s+\.side-group/);
  assert.match(css, /body\[data-theme="light"\]\s+\.info-banner/);
  assert.match(css, /body\[data-theme="light"\]\s+\.btn-primary/);
});
