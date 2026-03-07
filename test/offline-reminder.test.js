const test = require('node:test');
const assert = require('node:assert/strict');

const { buildOfflineReloginReminder } = require('../src/offlineReminder');

test('buildOfflineReloginReminder should include reason and relogin links', () => {
    const reminder = buildOfflineReloginReminder('长时间未操作', {
        url: 'https://example.test/relogin',
        backupUrls: ['https://example.test/alt-1', 'https://example.test/alt-2'],
    });

    assert.equal(reminder.title, 'QQ农场离线提醒');
    assert.equal(reminder.actionUrl, 'https://example.test/relogin');
    assert.match(reminder.dedupeKey, /长时间未操作/);
    assert.match(reminder.body, /长时间未操作/);
    assert.match(reminder.body, /https:\/\/example\.test\/relogin/);
    assert.match(reminder.body, /https:\/\/example\.test\/alt-1/);
});
