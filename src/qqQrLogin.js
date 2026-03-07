const axios = require('axios');
const qrcodeTerminal = require('qrcode-terminal');
const { emitUiEvent } = require('./uiEvents');
const { getRuntimeSettings } = require('./runtimeSettings');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const QUA = 'V1_HT5_QDT_0.70.2209190_x64_0_DEV_D';
const FARM_APP_ID = '1112386029';

function getApiDomain() {
    const runtime = getRuntimeSettings();
    const domain = String(runtime && runtime.qrLogin && runtime.qrLogin.apiDomain || 'q.qq.com').trim();
    return domain || 'q.qq.com';
}

function buildApiUrl(pathname, apiDomain = getApiDomain()) {
    const safePath = String(pathname || '').startsWith('/') ? String(pathname) : `/${String(pathname || '')}`;
    return `https://${apiDomain}${safePath}`;
}

function getHeaders(apiDomain = getApiDomain()) {
    return {
        qua: QUA,
        host: apiDomain,
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

function buildFallbackUrls(loginCode, apiDomain = getApiDomain()) {
    const code = encodeURIComponent(String(loginCode || '').trim());
    if (!code) return [];
    return [
        `https://h5.qzone.qq.com/qqq/code/${code}?_proxy=1&from=ide`,
        `https://${apiDomain}/qqq/code/${code}?_proxy=1&from=ide`,
        `https://${apiDomain}/qqq/code/${code}?from=ide`,
    ];
}

function resolveQrUrls(data, loginCode, options = {}) {
    const apiDomain = String(options.apiDomain || getApiDomain()).trim() || 'q.qq.com';
    const candidates = [
        ...buildFallbackUrls(loginCode, apiDomain),
        data && data.url,
        data && data.login_url,
        data && data.qr_url,
        data && data.qrcode_url,
        data && data.scan_url,
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
    const apiDomain = getApiDomain();
    const response = await axios.get(buildApiUrl('/ide/devtoolAuth/GetLoginCode', apiDomain), {
        headers: getHeaders(apiDomain),
    });

    const { code, data } = response.data || {};
    if (+code !== 0 || !data || !data.code) {
        throw new Error('获取QQ扫码登录码失败');
    }

    const { primaryUrl, backupUrls } = resolveQrUrls(data, data.code, { apiDomain });
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
    const apiDomain = getApiDomain();
    const response = await axios.get(
        `${buildApiUrl('/ide/devtoolAuth/syncScanSateGetTicket', apiDomain)}?code=${encodeURIComponent(loginCode)}`,
        { headers: getHeaders(apiDomain) }
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

function normalizeAuthCodeValue(value) {
    if (value === undefined || value === null) return '';
    const text = String(value).trim();
    if (!text) return '';
    if (/^-\d+$/.test(text)) return '';
    if (text === '0') return '';
    return text;
}

function pickAuthCodeFromPayload(payload = {}) {
    const candidates = [
        payload && payload.data && payload.data.code,
        payload && payload.authCode,
        payload && payload.auth_code,
        payload && payload.code,
    ];

    for (const candidate of candidates) {
        const authCode = normalizeAuthCodeValue(candidate);
        if (authCode) return authCode;
    }
    return '';
}

function describeAuthCodeFailure(payload = {}) {
    const parts = [];
    if (payload && payload.code !== undefined && payload.code !== null && String(payload.code).trim()) {
        parts.push(`code=${String(payload.code).trim()}`);
    }
    for (const key of ['msg', 'message', 'errmsg', 'error']) {
        const value = payload && payload[key];
        if (value !== undefined && value !== null && String(value).trim()) {
            parts.push(String(value).trim());
            break;
        }
    }
    return parts.join(' ').trim();
}

function shouldRetryAuthCodePayload(payload = {}) {
    const rawCode = payload && payload.code;
    if (rawCode === undefined || rawCode === null) return false;
    const text = String(rawCode).trim();
    if (!text) return false;
    if (/^-\d+$/.test(text)) return true;
    return text === '0';
}

async function getAuthCode(ticket, options = {}) {
    const apiDomain = getApiDomain();
    const requestPost = typeof options.requestPost === 'function' ? options.requestPost : axios.post;
    const sleep = typeof options.sleep === 'function'
        ? options.sleep
        : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const maxRetries = Number.isFinite(Number(options.maxRetries)) ? Math.max(0, Number(options.maxRetries)) : 2;
    const retryDelayMs = Number.isFinite(Number(options.retryDelayMs)) ? Math.max(0, Number(options.retryDelayMs)) : 800;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const response = await requestPost(
            buildApiUrl('/ide/login', apiDomain),
            { appid: FARM_APP_ID, ticket },
            { headers: getHeaders(apiDomain) }
        );

        const payload = response && response.data ? response.data : {};
        const authCode = response && response.status === 200 ? pickAuthCodeFromPayload(payload) : '';
        if (authCode) {
            return authCode;
        }

        const detail = describeAuthCodeFailure(payload);
        const canRetry = attempt < maxRetries && response && response.status === 200 && shouldRetryAuthCodePayload(payload);
        if (canRetry) {
            await sleep(retryDelayMs);
            continue;
        }

        throw new Error(detail ? `获取农场登录 code 失败: ${detail}` : '获取农场登录 code 失败');
    }

    throw new Error('获取农场登录 code 失败');
}

function shouldRetryAuthCodeExchangeError(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    const text = String(message || '').trim();
    if (!text) return false;
    const match = text.match(/(?:^|[\s:])code=(-?\d+)/i);
    if (!match) return false;
    const code = Number.parseInt(match[1], 10);
    return Number.isFinite(code) && code <= 0;
}

function emitQrState(payload, emitQrEvent = emitUiEvent) {
    emitQrEvent('qr', payload || {});
}

function printQr(url, backupUrls = [], options = {}) {
    const header = String(options.header || '[扫码登录] 请用 QQ 扫描下方二维码确认登录:').trim();
    const linkLabel = String(options.linkLabel || '[扫码登录] 打开链接扫码:').trim();
    const backupLabel = String(options.backupLabel || '[扫码登录] 若出现 404，可尝试以下备用链接:').trim();

    console.log('');
    console.log(header);
    qrcodeTerminal.generate(url, { small: true });
    console.log(`${linkLabel} ${url}`);
    if (backupUrls.length > 0) {
        console.log(backupLabel);
        for (const alt of backupUrls.slice(0, 3)) {
            console.log(`  - ${alt}`);
        }
    }
    console.log('');
}

async function waitForLoginCodeResult(options = {}) {
    const loginCode = String(options.loginCode || '').trim();
    const url = String(options.url || '').trim();
    const backupUrls = Array.isArray(options.backupUrls) ? options.backupUrls : [];
    const pollIntervalMs = Number(options.pollIntervalMs) > 0 ? Number(options.pollIntervalMs) : 2000;
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 180000;
    const waitingNoticeIntervalMs = Number(options.waitingNoticeIntervalMs) >= 0
        ? Number(options.waitingNoticeIntervalMs)
        : 15000;
    const queryStatus = typeof options.queryStatus === 'function' ? options.queryStatus : queryScanStatus;
    const exchangeTicket = typeof options.exchangeTicket === 'function' ? options.exchangeTicket : getAuthCode;
    const emitQrEvent = typeof options.emitQrEvent === 'function' ? options.emitQrEvent : emitUiEvent;
    const sleep = typeof options.sleep === 'function'
        ? options.sleep
        : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const waitingTemplate = String(options.waitingMessage || '').trim();

    if (!loginCode) {
        throw new Error('loginCode is required');
    }

    const start = now();
    let lastWaitingNoticeTs = start;
    let confirmedTicket = '';

    while (now() - start < timeoutMs) {
        if (!confirmedTicket) {
            const status = await queryStatus(loginCode);
            if (status.status === 'OK') {
                confirmedTicket = String(status.ticket || '').trim();
                if (!confirmedTicket) {
                    emitQrState({ phase: 'error', qrUrl: url, backupUrls, message: '扫码已确认但未获取到 ticket，请重试' }, emitQrEvent);
                    throw new Error('扫码已确认但未获取到 ticket，请重试');
                }
            } else if (status.status === 'Used') {
                emitQrState({ phase: 'expired', qrUrl: url, backupUrls, message: '二维码已失效，请重试' }, emitQrEvent);
                throw new Error('二维码已失效，请重试');
            } else if (status.status === 'Error') {
                emitQrState({ phase: 'error', qrUrl: url, backupUrls, message: '扫码状态查询失败，请重试' }, emitQrEvent);
                throw new Error('扫码状态查询失败，请重试');
            }
        }

        if (confirmedTicket) {
            try {
                const authCode = await exchangeTicket(confirmedTicket);
                emitQrState({ phase: 'confirmed', qrUrl: url, backupUrls }, emitQrEvent);
                return authCode;
            } catch (error) {
                if (!shouldRetryAuthCodeExchangeError(error)) {
                    throw error;
                }

                const ts = now();
                if (ts - lastWaitingNoticeTs >= waitingNoticeIntervalMs) {
                    lastWaitingNoticeTs = ts;
                    emitQrState({
                        phase: 'waiting',
                        qrUrl: url,
                        backupUrls,
                        message: '扫码已确认，正在获取登录 code，请稍候',
                    }, emitQrEvent);
                }
                await sleep(pollIntervalMs);
                continue;
            }
        }

        const ts = now();
        if (ts - lastWaitingNoticeTs >= waitingNoticeIntervalMs) {
            lastWaitingNoticeTs = ts;
            const elapsedSec = Math.floor((ts - start) / 1000);
            emitQrState({
                phase: 'waiting',
                qrUrl: url,
                backupUrls,
                message: waitingTemplate || `等待扫码中（${elapsedSec}s）`,
            }, emitQrEvent);
        }
        await sleep(pollIntervalMs);
    }

    if (confirmedTicket) {
        emitQrState({ phase: 'timeout', qrUrl: url, backupUrls, message: '扫码已确认，但获取登录 code 超时，请重试' }, emitQrEvent);
        throw new Error('扫码已确认，但获取登录 code 超时，请重试');
    }

    emitQrState({ phase: 'timeout', qrUrl: url, backupUrls, message: '扫码超时，请重试' }, emitQrEvent);
    throw new Error('扫码超时，请重试');
}

async function getQQFarmCodeByScan(options = {}) {
    const pollIntervalMs = Number(options.pollIntervalMs) > 0 ? Number(options.pollIntervalMs) : 2000;
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 180000;
    const relogin = Boolean(options.relogin);
    const requestLoginCodeFn = typeof options.requestLoginCode === 'function'
        ? options.requestLoginCode
        : requestLoginCode;
    const printQrFn = typeof options.printQrFn === 'function'
        ? options.printQrFn
        : printQr;
    const onCodeReady = typeof options.onCodeReady === 'function'
        ? options.onCodeReady
        : null;

    const { loginCode, url, backupUrls } = await requestLoginCodeFn();
    if (onCodeReady) {
        await onCodeReady({
            loginCode,
            url,
            backupUrls,
            relogin,
        });
    }
    printQrFn(url, backupUrls, {
        header: relogin
            ? '[重登录] 账号已下线，请用 QQ 扫描下方二维码重新登录:'
            : '[扫码登录] 请用 QQ 扫描下方二维码确认登录:',
        linkLabel: relogin
            ? '[重登录] 打开链接扫码:'
            : '[扫码登录] 打开链接扫码:',
        backupLabel: relogin
            ? '[重登录] 若出现 404，可尝试以下备用链接:'
            : '[扫码登录] 若出现 404，可尝试以下备用链接:',
    });

    emitQrState({
        phase: 'waiting',
        qrUrl: url,
        backupUrls,
        message: String(options.waitingMessage || '').trim()
            || (relogin ? '账号已下线，请扫码重新登录' : (backupUrls.length > 0 ? '若扫码跳 404，请尝试备用链接' : '')),
    }, typeof options.emitQrEvent === 'function' ? options.emitQrEvent : emitUiEvent);

    return waitForLoginCodeResult({
        loginCode,
        url,
        backupUrls,
        pollIntervalMs,
        timeoutMs,
        waitingMessage: String(options.waitingMessage || '').trim(),
        emitQrEvent: options.emitQrEvent,
        sleep: options.sleep,
        now: options.now,
        queryStatus: options.queryStatus,
        exchangeTicket: options.exchangeTicket,
    });
}

module.exports = {
    getQQFarmCodeByScan,
    resolveQrUrls,
    requestLoginCode,
    queryScanStatus,
    getAuthCode,
    waitForLoginCodeResult,
    __private: {
        normalizeAuthCodeValue,
        pickAuthCodeFromPayload,
        describeAuthCodeFailure,
        shouldRetryAuthCodePayload,
    },
};
