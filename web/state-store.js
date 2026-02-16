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

function normalizeLevel(level) {
    const raw = String(level || '').toLowerCase();
    if (raw === 'warn' || raw === 'error' || raw === 'info') return raw;
    return 'info';
}

function parsePositiveInt(value, fallback) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}

function normalizeKeyword(keyword) {
    return String(keyword || '').trim().toLowerCase();
}

function buildLogText(log) {
    return String(log.text || log.message || '');
}

function createStateStore(options = {}) {
    const maxLogs = Number.isFinite(options.maxLogs) ? Math.max(1, options.maxLogs) : 5000;
    const state = {
        sessions: {},
        logSeq: 0,
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
        const seq = ++state.logSeq;
        const ts = parsePositiveInt(log.ts, Date.now());
        const item = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            seq,
            ts,
            level: normalizeLevel(log.level),
            tag: log.tag || '',
            message: log.message || '',
            text: buildLogText(log),
            stream: log.stream || '',
            category: log.category || '',
            action: log.action || '',
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

    function deleteAccount(accountId) {
        const id = String(accountId || '').trim();
        if (!id || !state.sessions[id]) return false;
        delete state.sessions[id];
        return true;
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

    function queryLogs(filters = {}) {
        const rawAccountId = String(filters.accountId || 'all').trim();
        const accountId = rawAccountId || 'all';
        const level = String(filters.level || 'all').toLowerCase();
        const tag = String(filters.tag || '').trim();
        const keyword = normalizeKeyword(filters.keyword);
        const action = String(filters.action || '').trim();
        const limit = Math.min(parsePositiveInt(filters.limit, 200), 500);
        const beforeTs = Number.parseInt(filters.beforeTs, 10);
        const beforeSeq = Number.parseInt(filters.beforeSeq, 10);
        const hasCursor = Number.isFinite(beforeTs) && Number.isFinite(beforeSeq);

        const sourceAccountIds = accountId === 'all'
            ? Object.keys(state.sessions)
            : [accountId];
        const merged = [];
        for (const id of sourceAccountIds) {
            const account = state.sessions[id];
            if (!account || !Array.isArray(account.logs)) continue;
            for (const log of account.logs) {
                merged.push({
                    accountId: id,
                    ...log,
                });
            }
        }

        merged.sort((a, b) => {
            if (a.ts !== b.ts) return b.ts - a.ts;
            return b.seq - a.seq;
        });

        const items = [];
        for (const item of merged) {
            if (hasCursor) {
                const isOlder = item.ts < beforeTs || (item.ts === beforeTs && item.seq < beforeSeq);
                if (!isOlder) continue;
            }
            if (level !== 'all' && item.level !== level) continue;
            if (tag && item.tag !== tag) continue;
            if (action && item.action !== action) continue;
            if (keyword) {
                const haystack = `${item.tag} ${item.message} ${item.text}`.toLowerCase();
                if (!haystack.includes(keyword)) continue;
            }
            items.push(item);
            if (items.length >= limit) break;
        }

        let nextCursor = null;
        if (items.length > 0) {
            const last = items[items.length - 1];
            nextCursor = {
                beforeTs: last.ts,
                beforeSeq: last.seq,
            };
        }

        return {
            items: deepClone(items),
            nextCursor,
        };
    }

    return {
        ensureAccount,
        addLog,
        setSession,
        setStatus,
        setQr,
        setBestCrop,
        clearLogs,
        deleteAccount,
        getAccountSnapshot,
        listAccountIds,
        getSnapshot,
        queryLogs,
    };
}

module.exports = {
    createStateStore,
};
