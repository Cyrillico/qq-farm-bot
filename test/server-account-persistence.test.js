const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { startServer } = require('../web/server');
const { saveSettings, getDefaultSettings } = require('../web/settings-store');

class FakeSessionManager extends EventEmitter {
    constructor() {
        super();
        this.starts = [];
        this.stops = [];
    }

    start(accountId, params = {}) {
        this.starts.push({ accountId, params });
        this.emit('spawn', {
            accountId,
            pid: 12345,
            mode: params.mode || 'run',
            args: ['--mock'],
        });
        return {
            pid: 12345,
            mode: params.mode || 'run',
            args: ['--mock'],
        };
    }

    stop(accountId) {
        this.stops.push(accountId);
        this.emit('exit', {
            accountId,
            code: 0,
            signal: '',
            stopRequested: true,
        });
        return Promise.resolve(true);
    }

    deleteAccount() {
        return Promise.resolve(true);
    }

    applyBarkSettings() {
        return true;
    }

    applyAccountSettings() {
        return true;
    }
}

test('server restores persisted accounts and auto-starts enabled entries', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-server-accounts-'));
    const settingsPath = path.join(tempDir, 'settings.json');
    const statsPath = path.join(tempDir, 'stats.json');
    const defaults = getDefaultSettings();
    saveSettings(settingsPath, {
        ...defaults,
        accounts: {
            'qq-main': {
                mode: 'run',
                platform: 'qq',
                code: 'abc123',
                useQr: true,
                interval: '5',
                friendInterval: '2',
                autoStart: true,
            },
        },
    });

    const sessionManager = new FakeSessionManager();
    const started = await startServer({
        host: '127.0.0.1',
        port: 0,
        settingsPath,
        statsPath,
        createSessionManager: () => sessionManager,
        env: {},
    });

    try {
        assert.equal(sessionManager.starts.length, 1);
        assert.equal(sessionManager.starts[0].accountId, 'qq-main');

        const listenPort = started.server.address().port;
        const res = await fetch(`http://127.0.0.1:${listenPort}/api/state`);
        const data = await res.json();
        assert.equal(Boolean(data.state.sessions['qq-main']), true);
        assert.equal(data.settings.accounts['qq-main'].code, 'abc123');
        assert.equal(data.settings.accounts['qq-main'].autoStart, true);
    } finally {
        await started.close();
    }
});
