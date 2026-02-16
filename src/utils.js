/**
 * 通用工具函数
 */

const Long = require('long');
const { RUNTIME_HINT_MASK, RUNTIME_HINT_DATA } = require('./config');
const { pushWarn } = require('./bark');
const { emitUiEvent, isUiEventsEnabled } = require('./uiEvents');

// ============ 服务器时间状态 ============
let serverTimeMs = 0;
let localTimeAtSync = 0;

// ============ 类型转换 ============
function toLong(val) {
    return Long.fromNumber(val);
}

function toNum(val) {
    if (Long.isLong(val)) return val.toNumber();
    return val || 0;
}

// ============ 时间相关 ============
function now() {
    return new Date().toLocaleTimeString();
}

/** 获取当前推算的服务器时间(秒) */
function getServerTimeSec() {
    if (!serverTimeMs) return Math.floor(Date.now() / 1000);
    const elapsed = Date.now() - localTimeAtSync;
    return Math.floor((serverTimeMs + elapsed) / 1000);
}

/** 同步服务器时间 */
function syncServerTime(ms) {
    serverTimeMs = ms;
    localTimeAtSync = Date.now();
}

/**
 * 将时间戳归一化为秒级
 * 大于 1e12 认为是毫秒级，转换为秒级
 */
function toTimeSec(val) {
    const n = toNum(val);
    if (n <= 0) return 0;
    if (n > 1e12) return Math.floor(n / 1000);
    return n;
}

// ============ 日志 ============
function classifyWarnCategory(tag) {
    const t = String(tag || '').trim();
    if (['WS', '登录', '心跳', '错误', '解码'].includes(t)) {
        return 'network';
    }
    return 'business';
}

function log(tag, msg, meta = {}) {
    const action = String((meta && meta.action) || '').trim();
    const text = `[${now()}] [${tag}] ${msg}`;
    emitUiEvent('log', {
        level: 'info',
        tag: String(tag || ''),
        message: String(msg || ''),
        action,
        text,
    });
    if (!isUiEventsEnabled()) {
        console.log(text);
    }
}

function logWarn(tag, msg, category, meta = {}) {
    let pickedCategory = category;
    let pickedMeta = meta;
    if (typeof category === 'object' && category !== null) {
        pickedMeta = category;
        pickedCategory = '';
    }
    pickedCategory = pickedCategory || classifyWarnCategory(tag);
    const action = String((pickedMeta && pickedMeta.action) || '').trim();
    const text = `[${now()}] [${tag}] ⚠ ${msg}`;
    emitUiEvent('log', {
        level: 'warn',
        tag: String(tag || ''),
        message: String(msg || ''),
        category: pickedCategory,
        action,
        text,
    });
    if (!isUiEventsEnabled()) {
        console.log(text);
    }
    void pushWarn(tag, msg, { category: pickedCategory });
}

// ============ 异步工具 ============
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

let hintPrinted = false;
function decodeRuntimeHint() {
    return String.fromCharCode(...RUNTIME_HINT_DATA.map(n => n ^ RUNTIME_HINT_MASK));
}

/**
 * 输出开源声明：
 * - force=true 时必定输出（用于启动）
 * - 默认低频输出（用于业务流程中的隐性提示）
 */
function emitRuntimeHint(force = false) {
    if (!force) {
        // 约 3.3% 概率，且同一次进程最多输出 2 次
        if (Math.random() > 0.033) return;
        if (hintPrinted && Math.random() > 0.2) return;
    }
    log('声明', decodeRuntimeHint());
    hintPrinted = true;
}

module.exports = {
    toLong, toNum, now,
    getServerTimeSec, syncServerTime, toTimeSec,
    log, logWarn, classifyWarnCategory, sleep,
    emitRuntimeHint,
};
