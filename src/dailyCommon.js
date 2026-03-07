const { toNum } = require('./utils');
const { getItemName } = require('./gameConfig');

function getDateKey(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getRewardSummary(items) {
    const list = Array.isArray(items) ? items : [];
    const parts = [];
    for (const item of list) {
        const id = toNum(item.id);
        const count = toNum(item.count);
        if (count <= 0) continue;
        parts.push(`${getItemName(id)}${count}`);
    }
    return parts.join('/');
}

function isAlreadyClaimedError(error) {
    const msg = String(error && (error.message || error) || '');
    return msg.includes('code=1009001')
        || msg.includes('code=1018005')
        || msg.includes('已经领取')
        || msg.includes('已领取')
        || msg.includes('活动未解锁')
        || msg.includes('次数已达上限')
        || msg.includes('已达上限');
}

function createDailyCooldown(options = {}) {
    const cooldownMs = Number(options.cooldownMs) > 0 ? Number(options.cooldownMs) : (10 * 60 * 1000);
    let lastCheckAt = 0;
    let lastDateKey = '';
    return {
        canRun(force = false) {
            const now = Date.now();
            const currentKey = getDateKey();
            if (currentKey !== lastDateKey) return true;
            if (force && lastCheckAt === 0) return true;
            return now - lastCheckAt >= cooldownMs;
        },
        markRan() {
            const currentKey = getDateKey();
            if (currentKey !== lastDateKey) {
                lastCheckAt = 0;
            }
            lastCheckAt = Date.now();
            lastDateKey = currentKey;
        },
        getState() {
            return { lastCheckAt, lastDateKey, cooldownMs, currentKey: getDateKey() };
        },
        reset() {
            lastCheckAt = 0;
            lastDateKey = '';
        },
    };
}

module.exports = {
    getDateKey,
    getRewardSummary,
    isAlreadyClaimedError,
    createDailyCooldown,
};
