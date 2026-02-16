const path = require('node:path');
const { EventEmitter } = require('node:events');
const { SessionRunner } = require('./session-runner');

function normalizeAccountId(accountId) {
    const raw = String(accountId || 'default').trim();
    if (!raw) return 'default';
    const normalized = raw.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64);
    return normalized || 'default';
}

class SessionManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.rootDir = options.rootDir || path.join(__dirname, '..');
        this.createRunner = options.createRunner || (() => new SessionRunner({ rootDir: this.rootDir }));
        this.runners = new Map();
    }

    listAccounts() {
        return [...this.runners.keys()];
    }

    ensureRunner(accountId) {
        const id = normalizeAccountId(accountId);
        if (this.runners.has(id)) {
            return { accountId: id, runner: this.runners.get(id) };
        }

        const runner = this.createRunner(id);
        this.#bindRunner(id, runner);
        this.runners.set(id, runner);
        return { accountId: id, runner };
    }

    start(accountId, params = {}) {
        const { accountId: id, runner } = this.ensureRunner(accountId);
        const payload = { ...params };
        delete payload.accountId;
        const started = runner.start(payload);
        return {
            accountId: id,
            ...started,
        };
    }

    isRunning(accountId) {
        const id = normalizeAccountId(accountId);
        const runner = this.runners.get(id);
        return Boolean(runner && runner.isRunning());
    }

    async stop(accountId) {
        const id = normalizeAccountId(accountId);
        const runner = this.runners.get(id);
        if (!runner) return false;
        return runner.stop();
    }

    async stopAll() {
        const accountIds = this.listAccounts();
        const result = await Promise.all(accountIds.map((id) => this.stop(id)));
        const stopped = result.filter(Boolean).length;
        return {
            total: accountIds.length,
            stopped,
            accountIds,
        };
    }

    async deleteAccount(accountId) {
        const id = normalizeAccountId(accountId);
        const runner = this.runners.get(id);
        if (!runner) return false;
        try {
            if (runner.isRunning()) {
                await runner.stop();
            }
        } finally {
            this.runners.delete(id);
        }
        return true;
    }

    applyBarkSettings(accountId, barkSettings) {
        const id = normalizeAccountId(accountId);
        const runner = this.runners.get(id);
        if (!runner) return false;
        return runner.applyBarkSettings(barkSettings);
    }

    applyBarkSettingsToAll(barkSettings) {
        let applied = 0;
        for (const runner of this.runners.values()) {
            if (runner.applyBarkSettings(barkSettings)) {
                applied++;
            }
        }
        return applied;
    }

    async listFriends(accountId) {
        const id = normalizeAccountId(accountId);
        const runner = this.runners.get(id);
        if (!runner || !runner.isRunning()) {
            throw new Error('session not running');
        }
        if (typeof runner.callRpc !== 'function') {
            throw new Error('runner rpc unavailable');
        }
        return runner.callRpc('friends.list', {}, 10000);
    }

    async runFriendOp(accountId, payload = {}) {
        const id = normalizeAccountId(accountId);
        const runner = this.runners.get(id);
        if (!runner || !runner.isRunning()) {
            throw new Error('session not running');
        }
        if (typeof runner.callRpc !== 'function') {
            throw new Error('runner rpc unavailable');
        }
        return runner.callRpc('friends.op', payload || {}, 15000);
    }

    #bindRunner(accountId, runner) {
        const wrap = (type, payload) => {
            this.emit(type, {
                accountId,
                ...(payload || {}),
            });
        };

        runner.on('spawn', (payload) => wrap('spawn', payload));
        runner.on('line', (payload) => wrap('line', payload));
        runner.on('ui-event', (payload) => wrap('ui-event', payload));
        runner.on('child-message', (payload) => wrap('child-message', payload));
        runner.on('exit', (payload) => wrap('exit', payload));
    }
}

module.exports = {
    normalizeAccountId,
    SessionManager,
};
