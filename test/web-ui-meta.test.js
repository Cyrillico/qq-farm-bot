const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_VIEW,
  VIEW_META,
  NAV_GROUPS,
  getViewMeta,
} = require('../web/public/ui-meta.js');

test('UI 视图元数据提供分组、主操作和状态文案', () => {
  assert.equal(DEFAULT_VIEW, 'account-home');
  assert.ok(Array.isArray(NAV_GROUPS));
  assert.deepEqual(
    NAV_GROUPS.map((group) => group.key),
    ['overview', 'operations', 'automation', 'alerts', 'audit'],
  );

  const viewKeys = [
    'account-home',
    'account-lands',
    'account-bag',
    'account-daily-gifts',
    'account-analytics',
    'account-settings',
    'account-friends',
    'account-bark',
    'account-logs',
  ];

  for (const key of viewKeys) {
    const meta = getViewMeta(key);
    assert.equal(meta.key, key);
    assert.ok(meta.title);
    assert.ok(meta.hint);
    assert.ok(meta.group);
    assert.ok(meta.primaryAction);
    assert.ok(meta.primaryAction.label);
    assert.ok(meta.primaryAction.targetId);
    assert.ok(meta.emptyState);
    assert.ok(meta.loadingState);
    assert.equal(VIEW_META[key].group, meta.group);
  }
});
