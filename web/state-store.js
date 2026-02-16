function createDefaultAccountState(accountId) {
    return {
        accountId,
        session: {
            status: 'idle', // idle|starting|running|stopping|stopped|error
            mode: 'run',
            pid: null,
            startedAt: 0,
            stoppedAt: 0,
            lastError: '',
        },
        status: {
            platform: 'qq',
            name: '',
            level: 0,
            gold: 0,
            exp: 0,
        },
        qr: {
            phase: '',
            qrUrl: '',
            message: '',
        },
        bestCrop: null,
        logs: [],
    };
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function createStateStore(options = {}) {
    const maxLogs = Number.isFinite(options.maxLogs) ? Math.max(1, options.maxLogs) : 5000;
    const state = {
        sessions: {},
    };

    function ensureAccount(accountId = 'default') {
        const id = String(accountId || 'default');
        if (!state.sessions[id]) {
            state.sessions[id] = createDefaultAccountState(id);
        }
        return state.sessions[id];
    }

    function addLog(accountId, log) {
        const account = ensureAccount(accountId);
        const item = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            ts: Date.now(),
            level: log.level || 'info',
            tag: log.tag || '',
            message: log.message || '',
            text: log.text || '',
            stream: log.stream || '',
            category: log.category || '',
        };
        account.logs.push(item);
        if (account.logs.length > maxLogs) {
            const overflow = account.logs.length - maxLogs;
            account.logs.splice(0, overflow);
        }
        return deepClone(item);
    }

    function setSession(accountId, partial) {
        const account = ensureAccount(accountId);
        Object.assign(account.session, partial || {});
        return deepClone(account.session);
    }

    function setStatus(accountId, partial) {
        const account = ensureAccount(accountId);
        Object.assign(account.status, partial || {});
        return deepClone(account.status);
    }

    function setQr(accountId, partial) {
        const account = ensureAccount(accountId);
        Object.assign(account.qr, partial || {});
        return deepClone(account.qr);
    }

    function setBestCrop(accountId, partial) {
        const account = ensureAccount(accountId);
        account.bestCrop = partial ? { ...partial } : null;
        return deepClone(account.bestCrop);
    }

    function clearLogs(accountId) {
        if (accountId == null || accountId === '') {
            for (const id of Object.keys(state.sessions)) {
                state.sessions[id].logs = [];
            }
            return;
        }
        const account = ensureAccount(accountId);
        account.logs = [];
    }

    function getAccountSnapshot(accountId) {
        const account = ensureAccount(accountId);
        return deepClone(account);
    }

    function listAccountIds() {
        return Object.keys(state.sessions);
    }

    function getSnapshot() {
        return deepClone(state);
    }

    return {
        ensureAccount,
        addLog,
        setSession,
        setStatus,
        setQr,
        setBestCrop,
        clearLogs,
        getAccountSnapshot,
        listAccountIds,
        getSnapshot,
    };
}

module.exports = {
    createStateStore,
};
