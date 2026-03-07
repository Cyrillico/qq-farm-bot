const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../web/public/index.html'), 'utf8');

test('控制台页面包含运营面板壳层与关键工作台入口', () => {
  assert.match(html, /id="sidebarDrawerToggle"/);
  assert.match(html, /data-nav-group="overview"/);
  assert.match(html, /data-nav-group="operations"/);
  assert.match(html, /data-nav-group="automation"/);
  assert.match(html, /id="workbenchAccountName"/);
  assert.match(html, /id="workbenchAccountStatus"/);
  assert.match(html, /id="workbenchLastSync"/);
  assert.match(html, /id="viewPrimaryAction"/);
  assert.match(html, /id="dailyGiftsInsight"/);
  assert.match(html, /id="analyticsInsight"/);
  assert.match(html, /id="bagFilters"/);
  assert.match(html, /class="section-toolbar"/);
});
