const axios = require('axios');
const qrcodeTerminal = require('qrcode-terminal');
const { emitUiEvent } = require('./uiEvents');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const QUA = 'V1_HT5_QDT_0.70.2209190_x64_0_DEV_D';
const FARM_APP_ID = '1112386029';

function getHeaders() {
    return {
        qua: QUA,
        host: 'q.qq.com',
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': CHROME_UA,
    };
}

function normalizeUrl(value) {
    const text = String(value || '').trim();
    if (!/^https?:\/\//i.test(text)) return '';
    return text;
}

function buildFallbackUrls(loginCode) {
    const code = encodeURIComponent(String(loginCode || '').trim());
    if (!code) return [];
    return [
        `https://q.qq.com/qqq/code/${code}?_proxy=1&from=ide`,
        `https://h5.qzone.qq.com/qqq/code/${code}?_proxy=1&from=ide`,
        `https://q.qq.com/qqq/code/${code}?from=ide`,
    ];
}

function resolveQrUrls(data, loginCode) {
    const candidates = [
        data && data.url,
        data && data.login_url,
        data && data.qr_url,
        data && data.qrcode_url,
        data && data.scan_url,
        ...buildFallbackUrls(loginCode),
    ]
        .map(normalizeUrl)
        .filter(Boolean);

    const uniq = [];
    const seen = new Set();
    for (const url of candidates) {
        if (seen.has(url)) continue;
        seen.add(url);
        uniq.push(url);
    }

    return {
        primaryUrl: uniq[0] || '',
        backupUrls: uniq.slice(1),
    };
}

async function requestLoginCode() {
    const response = await axios.get('https://q.qq.com/ide/devtoolAuth/GetLoginCode', {
        headers: getHeaders(),
    });

    const { code, data } = response.data || {};
    if (+code !== 0 || !data || !data.code) {
        throw new Error('获取QQ扫码登录码失败');
    }

    const { primaryUrl, backupUrls } = resolveQrUrls(data, data.code);
    if (!primaryUrl) {
        throw new Error('获取到登录码但未解析出扫码链接');
    }

    return {
        loginCode: data.code,
        url: primaryUrl,
        backupUrls,
    };
}

async function queryScanStatus(loginCode) {
    const response = await axios.get(
        `https://q.qq.com/ide/devtoolAuth/syncScanSateGetTicket?code=${encodeURIComponent(loginCode)}`,
        { headers: getHeaders() }
    );

    if (response.status !== 200) return { status: 'Error' };

    const { code, data } = response.data || {};
    if (+code === 0) {
        if (+data?.ok !== 1) return { status: 'Wait' };
        return { status: 'OK', ticket: data.ticket || '' };
    }
    if (+code === -10003) return { status: 'Used' };
    return { status: 'Error' };
}

async function getAuthCode(ticket) {
    const response = await axios.post(
        'https://q.qq.com/ide/login',
        { appid: FARM_APP_ID, ticket },
        { headers: getHeaders() }
    );

    if (response.status !== 200 || !response.data || !response.data.code) {
        throw new Error('获取农场登录 code 失败');
    }

    return response.data.code;
}

function printQr(url, backupUrls = []) {
    console.log('');
    console.log('[扫码登录] 请用 QQ 扫描下方二维码确认登录:');
    qrcodeTerminal.generate(url, { small: true });
    console.log(`[扫码登录] 打开链接扫码: ${url}`);
    if (backupUrls.length > 0) {
        console.log('[扫码登录] 若出现 404，可尝试以下备用链接:');
        for (const alt of backupUrls.slice(0, 3)) {
            console.log(`  - ${alt}`);
        }
    }
    console.log('');
}

async function getQQFarmCodeByScan(options = {}) {
    const pollIntervalMs = Number(options.pollIntervalMs) > 0 ? Number(options.pollIntervalMs) : 2000;
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 180000;

    const { loginCode, url, backupUrls } = await requestLoginCode();
    printQr(url, backupUrls);
    emitUiEvent('qr', {
        phase: 'waiting',
        qrUrl: url,
        backupUrls,
        message: backupUrls.length > 0 ? '若扫码跳 404，请尝试备用链接' : '',
    });

    const start = Date.now();
    let lastWaitingNoticeTs = 0;
    while (Date.now() - start < timeoutMs) {
        const status = await queryScanStatus(loginCode);
        if (status.status === 'OK') {
            const authCode = await getAuthCode(status.ticket);
            emitUiEvent('qr', { phase: 'confirmed', qrUrl: url, backupUrls });
            return authCode;
        }
        if (status.status === 'Used') {
            emitUiEvent('qr', { phase: 'expired', qrUrl: url, backupUrls, message: '二维码已失效，请重试' });
            throw new Error('二维码已失效，请重试');
        }
        if (status.status === 'Error') {
            emitUiEvent('qr', { phase: 'error', qrUrl: url, backupUrls, message: '扫码状态查询失败，请重试' });
            throw new Error('扫码状态查询失败，请重试');
        }
        const now = Date.now();
        if (now - lastWaitingNoticeTs >= 15000) {
            lastWaitingNoticeTs = now;
            const elapsedSec = Math.floor((now - start) / 1000);
            emitUiEvent('qr', {
                phase: 'waiting',
                qrUrl: url,
                backupUrls,
                message: `等待扫码中（${elapsedSec}s）`,
            });
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    emitUiEvent('qr', { phase: 'timeout', qrUrl: url, backupUrls, message: '扫码超时，请重试' });
    throw new Error('扫码超时，请重试');
}

module.exports = {
    getQQFarmCodeByScan,
    resolveQrUrls,
};
