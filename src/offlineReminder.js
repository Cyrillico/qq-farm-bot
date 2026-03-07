function normalizeUrl(value) {
    const text = String(value || '').trim();
    if (!/^https?:\/\//i.test(text)) return '';
    return text;
}

function normalizeBackupUrls(values = [], primaryUrl = '') {
    const backupUrls = [];
    const seen = new Set(primaryUrl ? [primaryUrl] : []);
    for (const value of Array.isArray(values) ? values : []) {
        const url = normalizeUrl(value);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        backupUrls.push(url);
    }
    return backupUrls;
}

function buildOfflineReloginReminder(reasonText, qrPayload = {}) {
    const reason = String(reasonText || '').trim() || '未知原因';
    const url = normalizeUrl(qrPayload.url);
    const backupUrls = normalizeBackupUrls(qrPayload.backupUrls, url);
    const lines = [
        `账号已下线：${reason}`,
    ];

    if (url) {
        lines.push('点击通知可直接打开重登录链接，或复制下面链接重新登录：');
        lines.push(`登录链接：${url}`);
    } else {
        lines.push('请回到 WebUI 或终端查看重登录二维码。');
    }

    if (backupUrls.length > 0) {
        lines.push('备用链接：');
        for (const alt of backupUrls.slice(0, 3)) {
            lines.push(`- ${alt}`);
        }
    }

    return {
        title: 'QQ农场离线提醒',
        body: lines.join('\n'),
        actionUrl: url,
        dedupeKey: `offline-relogin:${reason}:${url}`,
    };
}

module.exports = {
    buildOfflineReloginReminder,
};
