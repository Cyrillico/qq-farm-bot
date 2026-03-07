function normalizePlatform(platform) {
    return String(platform || '').trim().toLowerCase() === 'wx' ? 'wx' : 'qq';
}

function shouldAttemptAutoReconnectForKickout(reason, options = {}) {
    const text = String(reason || '').trim();
    if (!text) return false;
    if (!/(长时间.*未操作|未操作.*过长|未操作时间过长|长时间未操作|inactivity|idle)/i.test(text)) {
        return false;
    }
    return normalizePlatform(options.platform) === 'qq';
}

function shouldMarkLoginInvalidForWsError(payload = {}) {
    const code = Number(payload && payload.code);
    const message = String((payload && payload.message) || '').trim();
    if (code === 400) return true;
    if (!message) return false;
    return /(Unexpected server response:\s*400|登录失效|login code|invalid login code|invalid code|更新\s*code)/i.test(message);
}

module.exports = {
    shouldAttemptAutoReconnectForKickout,
    shouldMarkLoginInvalidForWsError,
};
