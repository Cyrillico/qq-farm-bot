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
        stats: createDefaultAccountStats(),
    };
}

function createDefaultStatsCounts() {
    return {
        kickout: 0,
        wsClose: 0,
        harvest: 0,
        plant: 0,
        friendManual: 0,
        warn: 0,
        error: 0,
        barkSuccess: 0,
        barkFailed: 0,
        barkDeduped: 0,
        barkByCategory: {
            fatal: 0,
            network: 0,
            business: 0,
        },
    };
}

function createDefaultAccountStats() {
    return {
        dayKey: '',
        dayStartTs: 0,
        current: {
            platform: 'qq',
            name: '',
            level: 0,
            exp: 0,
            gold: 0,
        },
        baseline: {
            exp: null,
            gold: null,
        },
        today: {
            expDelta: 0,
            goldDelta: 0,
        },
        runtime: {
            runningMsToday: 0,
            runningSinceTs: 0,
            lastStatus: 'idle',
        },
        counts: createDefaultStatsCounts(),
        trends: {
            exp: [],
            gold: [],
        },
        meta: {
            lastStatusTs: 0,
            lastLogTs: 0,
        },
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

function toSafeNum(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function getDayMeta(ts) {
    const d = new Date(ts);
    const year = d.getFullYear();
    const month = d.getMonth();
    const date = d.getDate();
    const start = new Date(year, month, date, 0, 0, 0, 0).getTime();
    const key = `${year}-${pad2(month + 1)}-${pad2(date)}`;
    return { key, startTs: start };
}

function trimTrend(points, maxPoints = 240) {
    if (!Array.isArray(points)) return [];
    if (points.length <= maxPoints) return points;
    points.splice(0, points.length - maxPoints);
    return points;
}

function ensureStatsDay(account, now) {
    const stats = account.stats || (account.stats = createDefaultAccountStats());
    const { key, startTs } = getDayMeta(now);
    if (stats.dayKey === key) return stats;

    const currentStatus = String(((account.session || {}).status) || stats.runtime.lastStatus || 'idle');

    stats.dayKey = key;
    stats.dayStartTs = startTs;
    stats.today.expDelta = 0;
    stats.today.goldDelta = 0;
    stats.baseline.exp = null;
    stats.baseline.gold = null;
    stats.counts = createDefaultStatsCounts();
    stats.trends = { exp: [], gold: [] };
    stats.runtime.runningMsToday = 0;
    stats.runtime.lastStatus = currentStatus;
    if (currentStatus === 'running') {
        stats.runtime.runningSinceTs = Math.max(startTs, toSafeNum(stats.runtime.runningSinceTs, 0) || now);
    } else {
        stats.runtime.runningSinceTs = 0;
    }
    return stats;
}

function ensureBarkCategoryCounter(stats, category) {
    if (!stats.counts || !stats.counts.barkByCategory) {
        if (!stats.counts) stats.counts = createDefaultStatsCounts();
        if (!stats.counts.barkByCategory) {
            stats.counts.barkByCategory = createDefaultStatsCounts().barkByCategory;
        }
    }
    const key = ['fatal', 'network', 'business'].includes(category) ? category : 'business';
    if (!Number.isFinite(Number(stats.counts.barkByCategory[key]))) {
        stats.counts.barkByCategory[key] = 0;
    }
    return key;
}

function pushTrendPoint(stats, key, ts, value) {
    const series = stats.trends[key];
    if (!Array.isArray(series)) return;
    const nValue = toSafeNum(value, 0);
    const nTs = Math.max(0, toSafeNum(ts, Date.now()));
    const last = series[series.length - 1];
    if (last && last.v === nValue && Math.abs(nTs - last.ts) < 1000) {
        return;
    }
    series.push({ ts: nTs, v: nValue });
    trimTrend(series);
}

function updateStatusStats(account, now) {
    const stats = ensureStatsDay(account, now);
    const status = account.status || {};
    stats.current.platform = status.platform || stats.current.platform || 'qq';
    stats.current.name = status.name || stats.current.name || '';
    stats.current.level = toSafeNum(status.level, stats.current.level || 0);
    stats.current.exp = toSafeNum(status.exp, stats.current.exp || 0);
    stats.current.gold = toSafeNum(status.gold, stats.current.gold || 0);
    stats.meta.lastStatusTs = now;

    if (stats.baseline.exp == null) stats.baseline.exp = stats.current.exp;
    if (stats.baseline.gold == null) stats.baseline.gold = stats.current.gold;
    stats.today.expDelta = Math.max(0, stats.current.exp - toSafeNum(stats.baseline.exp, stats.current.exp));
    stats.today.goldDelta = stats.current.gold - toSafeNum(stats.baseline.gold, stats.current.gold);

    pushTrendPoint(stats, 'exp', now, stats.current.exp);
    pushTrendPoint(stats, 'gold', now, stats.current.gold);
}

function finalizeRunningSegmentIfNeeded(account, now) {
    const stats = ensureStatsDay(account, now);
    if (stats.runtime.runningSinceTs > 0) {
        const delta = Math.max(0, now - stats.runtime.runningSinceTs);
        stats.runtime.runningMsToday += delta;
        stats.runtime.runningSinceTs = 0;
    }
}

function updateSessionStats(account, previousSession, partial, now) {
    const stats = ensureStatsDay(account, now);
    const prevStatus = String((previousSession && previousSession.status) || stats.runtime.lastStatus || 'idle');
    const nextStatus = String(((account.session || {}).status) || prevStatus || 'idle');
    const startedAt = Math.max(0, toSafeNum((partial && partial.startedAt), now));
    const stoppedAt = Math.max(0, toSafeNum((partial && partial.stoppedAt), now));

    if (prevStatus === 'running' && nextStatus !== 'running') {
        const endTs = stoppedAt || now;
        if (stats.runtime.runningSinceTs > 0) {
            stats.runtime.runningMsToday += Math.max(0, endTs - stats.runtime.runningSinceTs);
            stats.runtime.runningSinceTs = 0;
        }
    } else if (prevStatus !== 'running' && nextStatus === 'running') {
        stats.runtime.runningSinceTs = Math.max(stats.dayStartTs || 0, startedAt || now);
    } else if (prevStatus === 'running' && nextStatus === 'running' && !stats.runtime.runningSinceTs) {
        stats.runtime.runningSinceTs = Math.max(stats.dayStartTs || 0, startedAt || now);
    }

    stats.runtime.lastStatus = nextStatus;
}

function updateLogStats(account, item) {
    const ts = Math.max(0, toSafeNum(item.ts, Date.now()));
    const stats = ensureStatsDay(account, ts);
    const text = String(item.text || item.message || '');
    const tag = String(item.tag || '');
    const action = String(item.action || '');
    const level = String(item.level || 'info');

    stats.meta.lastLogTs = ts;
    if (level === 'warn') stats.counts.warn += 1;
    if (level === 'error') stats.counts.error += 1;

    if (text.includes('被踢下线')) {
        stats.counts.kickout += 1;
    }
    if ((tag === 'WS' || text.includes('[WS]')) && text.includes('连接关闭')) {
        stats.counts.wsClose += 1;
    }
    if (action === 'friend_manual') {
        stats.counts.friendManual += 1;
    }

    const harvestPlantMatch = text.match(/收获\s*(\d+)\s*\/\s*种植\s*(\d+)/);
    if (harvestPlantMatch) {
        stats.counts.harvest += Number.parseInt(harvestPlantMatch[1], 10) || 0;
        stats.counts.plant += Number.parseInt(harvestPlantMatch[2], 10) || 0;
        return;
    }

    const harvestMatch = text.match(/收获\s*(\d+)/);
    if (harvestMatch && tag !== '好友') {
        stats.counts.harvest += Number.parseInt(harvestMatch[1], 10) || 0;
    }
    const plantMatch = text.match(/种植\s*(\d+)/);
    if (plantMatch && tag !== '好友') {
        stats.counts.plant += Number.parseInt(plantMatch[1], 10) || 0;
    }
}

function updateMetricStats(account, metric, now) {
    const stats = ensureStatsDay(account, now);
    const type = String(metric && metric.type || '').trim().toLowerCase();
    if (type !== 'bark') return false;

    const sent = Boolean(metric.sent);
    const reason = String(metric.reason || '').trim();
    const category = ensureBarkCategoryCounter(stats, String(metric.category || '').trim().toLowerCase());
    stats.counts.barkByCategory[category] += 1;

    if (sent) {
        stats.counts.barkSuccess += 1;
        return true;
    }
    if (reason === 'deduped') {
        stats.counts.barkDeduped += 1;
        return true;
    }
    stats.counts.barkFailed += 1;
    return true;
}

function normalizeImportedStats(raw) {
    const base = createDefaultAccountStats();
    const src = raw && typeof raw === 'object' ? raw : {};

    base.dayKey = String(src.dayKey || '');
    base.dayStartTs = Math.max(0, toSafeNum(src.dayStartTs, 0));

    if (src.current && typeof src.current === 'object') {
        base.current.platform = String(src.current.platform || base.current.platform || 'qq');
        base.current.name = String(src.current.name || '');
        base.current.level = toSafeNum(src.current.level, 0);
        base.current.exp = toSafeNum(src.current.exp, 0);
        base.current.gold = toSafeNum(src.current.gold, 0);
    }

    if (src.baseline && typeof src.baseline === 'object') {
        base.baseline.exp = src.baseline.exp == null ? null : toSafeNum(src.baseline.exp, 0);
        base.baseline.gold = src.baseline.gold == null ? null : toSafeNum(src.baseline.gold, 0);
    }
    if (src.today && typeof src.today === 'object') {
        base.today.expDelta = Math.max(0, toSafeNum(src.today.expDelta, 0));
        base.today.goldDelta = toSafeNum(src.today.goldDelta, 0);
    }
    if (src.runtime && typeof src.runtime === 'object') {
        base.runtime.runningMsToday = Math.max(0, toSafeNum(src.runtime.runningMsToday, 0));
        base.runtime.runningSinceTs = Math.max(0, toSafeNum(src.runtime.runningSinceTs, 0));
        base.runtime.lastStatus = String(src.runtime.lastStatus || 'idle');
    }
    if (src.counts && typeof src.counts === 'object') {
        for (const key of Object.keys(base.counts)) {
            if (key === 'barkByCategory') continue;
            base.counts[key] = Math.max(0, toSafeNum(src.counts[key], base.counts[key]));
        }
        const incomingBarkCats = src.counts.barkByCategory && typeof src.counts.barkByCategory === 'object'
            ? src.counts.barkByCategory
            : {};
        for (const key of Object.keys(base.counts.barkByCategory)) {
            base.counts.barkByCategory[key] = Math.max(0, toSafeNum(incomingBarkCats[key], 0));
        }
    }
    if (src.trends && typeof src.trends === 'object') {
        const normSeries = (arr) => {
            if (!Array.isArray(arr)) return [];
            return arr
                .map((p) => ({
                    ts: Math.max(0, toSafeNum(p && p.ts, 0)),
                    v: toSafeNum(p && p.v, 0),
                }))
                .filter((p) => p.ts > 0)
                .slice(-240);
        };
        base.trends.exp = normSeries(src.trends.exp);
        base.trends.gold = normSeries(src.trends.gold);
    }
    if (src.meta && typeof src.meta === 'object') {
        base.meta.lastStatusTs = Math.max(0, toSafeNum(src.meta.lastStatusTs, 0));
        base.meta.lastLogTs = Math.max(0, toSafeNum(src.meta.lastLogTs, 0));
    }

    return base;
}

function getAccountStatsView(account, now) {
    const stats = ensureStatsDay(account, now);
    const session = account.session || {};
    let runningMsToday = Math.max(0, toSafeNum(stats.runtime.runningMsToday, 0));
    if (String(session.status || '') === 'running' && stats.runtime.runningSinceTs > 0) {
        runningMsToday += Math.max(0, now - stats.runtime.runningSinceTs);
    }
    const runningHours = runningMsToday / 3600000;
    const expDelta = Math.max(0, toSafeNum(stats.today.expDelta, 0));
    const goldDelta = toSafeNum(stats.today.goldDelta, 0);
    const expPerHour = runningHours > 0 ? Number((expDelta / runningHours).toFixed(2)) : 0;
    const goldPerHour = runningHours > 0 ? Number((goldDelta / runningHours).toFixed(2)) : 0;

    return {
        dayKey: stats.dayKey,
        current: deepClone(stats.current),
        today: {
            expDelta,
            goldDelta,
            expPerHour,
            goldPerHour,
        },
        runtime: {
            runningMsToday,
            lastStatus: stats.runtime.lastStatus,
            lastStatusTs: stats.meta.lastStatusTs,
            lastLogTs: stats.meta.lastLogTs,
        },
        counts: deepClone(stats.counts),
        trends: {
            exp: deepClone(stats.trends.exp),
            gold: deepClone(stats.trends.gold),
        },
    };
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

    function addLog(accountId, log, meta = {}) {
        const account = ensureAccount(accountId);
        const seq = ++state.logSeq;
        const ts = parsePositiveInt(log.ts, Number.isFinite(meta.now) ? meta.now : Date.now());
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
        updateLogStats(account, item);
        return deepClone(item);
    }

    function setSession(accountId, partial, meta = {}) {
        const account = ensureAccount(accountId);
        const previousSession = { ...account.session };
        Object.assign(account.session, partial || {});
        updateSessionStats(account, previousSession, partial || {}, Number.isFinite(meta.now) ? meta.now : Date.now());
        return deepClone(account.session);
    }

    function setStatus(accountId, partial, meta = {}) {
        const account = ensureAccount(accountId);
        Object.assign(account.status, partial || {});
        updateStatusStats(account, Number.isFinite(meta.now) ? meta.now : Date.now());
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

    function recordMetricEvent(accountId, metric = {}, meta = {}) {
        const account = ensureAccount(accountId);
        const now = Number.isFinite(meta.now) ? meta.now : Date.now();
        const changed = updateMetricStats(account, metric || {}, now);
        return {
            ok: true,
            changed: Boolean(changed),
        };
    }

    function getStatsSnapshot(options = {}) {
        const now = Number.isFinite(options.now) ? options.now : Date.now();
        const accountIds = Object.keys(state.sessions);
        const accounts = {};
        const ranking = [];
        const summary = {
            totalAccounts: accountIds.length,
            runningAccounts: 0,
            errorAccounts: 0,
            stoppedAccounts: 0,
            totalExpDelta: 0,
            totalGoldDelta: 0,
            totalRunningMsToday: 0,
            counts: {
                ...createDefaultStatsCounts(),
            },
            rankingByExpPerHour: [],
        };

        for (const id of accountIds) {
            const account = state.sessions[id];
            if (!account) continue;
            const view = getAccountStatsView(account, now);
            accounts[id] = view;

            const sessionStatus = String(((account.session || {}).status) || '').toLowerCase();
            if (sessionStatus === 'running') summary.runningAccounts += 1;
            else if (sessionStatus === 'error') summary.errorAccounts += 1;
            else summary.stoppedAccounts += 1;

            summary.totalExpDelta += toSafeNum(view.today.expDelta, 0);
            summary.totalGoldDelta += toSafeNum(view.today.goldDelta, 0);
            summary.totalRunningMsToday += toSafeNum(view.runtime.runningMsToday, 0);
            for (const key of Object.keys(summary.counts)) {
                if (key === 'barkByCategory') continue;
                summary.counts[key] += toSafeNum(view.counts[key], 0);
            }
            if (summary.counts.barkByCategory && view.counts && view.counts.barkByCategory) {
                for (const barkKey of Object.keys(summary.counts.barkByCategory)) {
                    summary.counts.barkByCategory[barkKey] += toSafeNum(view.counts.barkByCategory[barkKey], 0);
                }
            }
            ranking.push({
                accountId: id,
                expPerHour: toSafeNum(view.today.expPerHour, 0),
                expDelta: toSafeNum(view.today.expDelta, 0),
                runningMsToday: toSafeNum(view.runtime.runningMsToday, 0),
                platform: (view.current && view.current.platform) || 'qq',
                name: (view.current && view.current.name) || '',
            });
        }

        ranking.sort((a, b) => {
            if (b.expPerHour !== a.expPerHour) return b.expPerHour - a.expPerHour;
            if (b.expDelta !== a.expDelta) return b.expDelta - a.expDelta;
            return String(a.accountId).localeCompare(String(b.accountId), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
        });
        summary.rankingByExpPerHour = ranking.slice(0, 10);

        return {
            ts: now,
            accounts,
            summary,
        };
    }

    function getAccountStats(accountId, options = {}) {
        const account = ensureAccount(accountId);
        const now = Number.isFinite(options.now) ? options.now : Date.now();
        return getAccountStatsView(account, now);
    }

    function exportStatsState() {
        const sessions = {};
        for (const id of Object.keys(state.sessions)) {
            const account = state.sessions[id];
            if (!account || !account.stats) continue;
            sessions[id] = {
                stats: deepClone(account.stats),
            };
        }
        return {
            version: 1,
            exportedAt: Date.now(),
            sessions,
        };
    }

    function importStatsState(payload = {}) {
        const raw = payload && typeof payload === 'object' ? payload : {};
        const sessions = raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {};
        let restored = 0;
        for (const [accountId, item] of Object.entries(sessions)) {
            if (!item || typeof item !== 'object' || !item.stats) continue;
            const account = ensureAccount(accountId);
            account.stats = normalizeImportedStats(item.stats);
            restored += 1;
        }
        return {
            ok: true,
            restored,
        };
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
        recordMetricEvent,
        getStatsSnapshot,
        getAccountStats,
        exportStatsState,
        importStatsState,
        queryLogs,
    };
}

module.exports = {
    createStateStore,
};
