const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { SessionManager } = require('../web/session-manager');

class FakeRunner extends EventEmitter {
    constructor() {
        super();
        this.running = false;
        this.applied = [];
        this.pid = Math.floor(Math.random() * 100000) + 1000;
    }

    isRunning() {
        return this.running;
    }

    start(params = {}) {
        if (this.running) throw new Error('already running');
        this.running = true;
        this.emit('spawn', {
            pid: this.pid,
            mode: params.mode || 'run',
            args: ['--mock'],
        });
        return {
            pid: this.pid,
            mode: params.mode || 'run',
            args: ['--mock'],
        };
    }

    stop() {
        if (!this.running) return Promise.resolve(false);
        this.running = false;
        this.emit('exit', {
            code: 0,
            signal: '',
            stopRequested: true,
            mode: 'run',
            args: [],
        });
        return Promise.resolve(true);
    }

    applyBarkSettings(settings) {
        this.applied.push(settings);
        return true;
    }
}

test('session manager supports multi-account start and bark broadcast', async () => {
    const manager = new SessionManager({
        createRunner: () => new FakeRunner(),
    });

    const a = manager.start('qq-main', { mode: 'run', platform: 'qq', code: 'q-code' });
    const b = manager.start('wx-main', { mode: 'run', platform: 'wx', code: 'w-code' });

    assert.equal(a.mode, 'run');
    assert.equal(b.mode, 'run');
    assert.equal(manager.isRunning('qq-main'), true);
    assert.equal(manager.isRunning('wx-main'), true);

    const count = manager.applyBarkSettingsToAll({ enabled: true });
    assert.equal(count, 2);

    const stopped = await manager.stopAll();
    assert.equal(stopped.total, 2);
    assert.equal(stopped.stopped, 2);
    assert.equal(manager.isRunning('qq-main'), false);
    assert.equal(manager.isRunning('wx-main'), false);
});
