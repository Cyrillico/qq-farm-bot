/**
 * QQ经典农场 挂机脚本 - 入口文件
 *
 * 模块结构:
 *   src/config.js   - 配置常量与枚举
 *   src/utils.js    - 通用工具函数
 *   src/proto.js    - Protobuf 加载与类型管理
 *   src/network.js  - WebSocket 连接/消息编解码/登录/心跳
 *   src/farm.js     - 自己农场操作与巡田循环
 *   src/friend.js   - 好友农场操作与巡查循环
 *   src/decode.js   - PB解码/验证工具模式
 */

const { CONFIG } = require('./src/config');
const { loadProto } = require('./src/proto');
const { connect, reconnect, cleanup, getWs, markManualClose, networkEvents } = require('./src/network');
const {
    shouldAttemptAutoReconnectForKickout,
    shouldAttemptAutoReloginForWsError,
} = require('./src/reconnectPolicy');
const {
    startFarmCheckLoop,
    stopFarmCheckLoop,
    listLandsForUi,
    updateFarmRuntimeSettings,
} = require('./src/farm');
const {
    startFriendCheckLoop,
    stopFriendCheckLoop,
    listFriendsForUi,
    runManualFriendOp,
    updateFriendRuntimeSettings,
} = require('./src/friend');
const {
    initTaskSystem,
    cleanupTaskSystem,
    updateTaskRuntimeSettings,
    getDailyGiftOverview,
    claimDailyGiftByKey,
} = require('./src/task');
const { initStatusBar, cleanupStatusBar, setStatusPlatform } = require('./src/status');
const { startSellLoop, stopSellLoop, debugSellFruits, listBagForUi } = require('./src/warehouse');
const { processInviteCodes } = require('./src/invite');
const { verifyMode, decodeMode } = require('./src/decode');
const { emitRuntimeHint } = require('./src/utils');
const { getQQFarmCodeByScan } = require('./src/qqQrLogin');
const { pushBark, pushBarkDetailed } = require('./src/bark');
const { emitUiEvent } = require('./src/uiEvents');
const { buildOfflineReloginReminder } = require('./src/offlineReminder');
const { buildLoginStartupPlan } = require('./src/loginWarmup');
const {
    updateRuntimeBarkSettings,
    updateRuntimeAccountSettings,
    updateRuntimeQrLoginSettings,
    loadRuntimeSettingsFromLocalFile,
} = require('./src/runtimeSettings');

// ============ 帮助信息 ============
function showHelp() {
    console.log(`
QQ经典农场 挂机脚本
====================

用法:
  node client.js --code <登录code> [--wx] [--interval <秒>] [--friend-interval <秒>]
  node client.js --qr [--interval <秒>] [--friend-interval <秒>]
  node client.js --verify
  node client.js --decode <数据> [--hex] [--gate] [--type <消息类型>]

参数:
  --code              小程序 login() 返回的临时凭证 (必需)
  --qr                启动后使用QQ扫码获取登录code（仅QQ平台）
  --wx                使用微信登录 (默认为QQ小程序)
  --interval          自己农场巡查完成后等待秒数, 默认10秒, 最低10秒
  --friend-interval   好友巡查完成后等待秒数, 默认1秒, 最低1秒
  --verify            验证proto定义
  --decode            解码PB数据 (运行 --decode 无参数查看详细帮助)

功能:
  - 自动收获成熟作物 → 购买种子 → 种植 → 施肥(可自动补肥)
  - 自动解锁/升级土地（协议支持时）
  - 自动除草、除虫、浇水
  - 自动铲除枯死作物
  - 自动巡查好友农场: 帮忙浇水/除草/除虫 + 偷菜
  - 自动领取任务奖励 (支持分享翻倍) + 活跃礼包 + 背包礼包开启
  - 每分钟自动出售仓库果实
  - 启动时读取 share.txt 处理邀请码 (仅微信)
  - 心跳保活

邀请码文件 (share.txt):
  每行一个邀请链接，格式: ?uid=xxx&openid=xxx&share_source=xxx&doc_id=xxx
  启动时会尝试通过 SyncAll API 同步这些好友
`);
}

// ============ 参数解析 ============
function parseArgs(args) {
    const options = {
        code: '',
        qrLogin: false,
        deleteAccountMode: false,
        name: '',
        certId: '',
        certType: 0,
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--code' && args[i + 1]) {
            options.code = args[++i];
        }
        if (args[i] === '--qr') {
            options.qrLogin = true;
        }
        if (args[i] === '--wx') {
            CONFIG.platform = 'wx';
        }
        if (args[i] === '--interval' && args[i + 1]) {
            const sec = parseInt(args[++i]);
            CONFIG.farmCheckInterval = Math.max(sec, 1) * 1000;
        }
        if (args[i] === '--friend-interval' && args[i + 1]) {
            const sec = parseInt(args[++i]);
            CONFIG.friendCheckInterval = Math.max(sec, 1) * 1000;  // 最低1秒
        }
    }
    return options;
}

function formatErrorDetail(err) {
    if (err instanceof Error) {
        return `${err.name}: ${err.message}`;
    }
    if (typeof err === 'string') {
        return err;
    }
    try {
        return JSON.stringify(err);
    } catch (e) {
        return String(err);
    }
}

function emitProcessState(state, payload = {}) {
    emitUiEvent('process', {
        state,
        ...payload,
    });
}

function getRunMode(args) {
    if (args.includes('--verify')) return 'verify';
    if (args.includes('--decode')) return 'decode';
    return 'run';
}

const subsystemState = {
    farmLoopStarted: false,
    friendLoopStarted: false,
    taskSystemStarted: false,
    sellLoopStarted: false,
};
let runtimeSubsystemsReady = false;
let unexpectedWsClosing = false;
let reloginInProgress = false;
let startupWarmupTimers = [];
let startupWarmupActive = false;
let startupWarmupPendingCount = 0;

async function pushCriticalBarkWithTimeout(title, message, dedupeKey, options = {}) {
    const category = String(options.category || 'fatal');
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Number(options.timeoutMs)
        : 2000;
    const actionUrl = String(options.actionUrl || '').trim();
    try {
        const ret = await Promise.race([
            pushBarkDetailed(title, message, dedupeKey, { category, actionUrl }),
            new Promise((resolve) => setTimeout(() => resolve({
                sent: false,
                reason: 'timeout',
                detail: `>${timeoutMs}ms`,
            }), timeoutMs)),
        ]);
        if (ret && ret.sent) return true;
        const reason = ret && ret.reason ? ret.reason : 'unknown';
        const detail = ret && ret.detail ? ` ${ret.detail}` : '';
        console.warn(`[Bark] 关键告警未发送: ${reason}${detail}`);
        return false;
    } catch (e) {
        return false;
    }
}

function setFarmSubsystemEnabled(enabled) {
    if (enabled) {
        if (!subsystemState.farmLoopStarted) {
            startFarmCheckLoop();
            subsystemState.farmLoopStarted = true;
        }
        return;
    }
    if (subsystemState.farmLoopStarted) {
        stopFarmCheckLoop();
        subsystemState.farmLoopStarted = false;
    }
}

function setFriendSubsystemEnabled(enabled) {
    if (enabled) {
        if (!subsystemState.friendLoopStarted) {
            startFriendCheckLoop();
            subsystemState.friendLoopStarted = true;
        }
        return;
    }
    if (subsystemState.friendLoopStarted) {
        stopFriendCheckLoop();
        subsystemState.friendLoopStarted = false;
    }
}

function setTaskSubsystemEnabled(enabled) {
    if (enabled) {
        if (!subsystemState.taskSystemStarted) {
            initTaskSystem();
            subsystemState.taskSystemStarted = true;
        }
        return;
    }
    if (subsystemState.taskSystemStarted) {
        cleanupTaskSystem();
        subsystemState.taskSystemStarted = false;
    }
}

function setSellSubsystemEnabled(enabled) {
    if (enabled) {
        if (!subsystemState.sellLoopStarted) {
            startSellLoop(60000);
            subsystemState.sellLoopStarted = true;
        }
        return;
    }
    if (subsystemState.sellLoopStarted) {
        stopSellLoop();
        subsystemState.sellLoopStarted = false;
    }
}

function clearRuntimeStartupPlan() {
    for (const timer of startupWarmupTimers) {
        clearTimeout(timer);
    }
    startupWarmupTimers = [];
    startupWarmupPendingCount = 0;
    startupWarmupActive = false;
}

function finishRuntimeStartupStep() {
    if (!startupWarmupPendingCount) {
        startupWarmupActive = false;
        return;
    }
    startupWarmupPendingCount = Math.max(0, startupWarmupPendingCount - 1);
    if (startupWarmupPendingCount === 0) {
        startupWarmupActive = false;
    }
}

function runRuntimeStartupStep(stepKey, account = {}) {
    switch (stepKey) {
        case 'farm':
            setFarmSubsystemEnabled(Boolean(account.farmEnabled));
            return;
        case 'friend':
            setFriendSubsystemEnabled(Boolean(account.friendEnabled));
            return;
        case 'task':
            setTaskSubsystemEnabled(Boolean(account.taskEnabled));
            return;
        case 'sell':
            setSellSubsystemEnabled(Boolean(account.sellEnabled));
            return;
        case 'sellDebug':
            if (account.sellEnabled) {
                void debugSellFruits();
            }
            return;
        default:
            return;
    }
}

function scheduleRuntimeSubsystemStartup(account = {}) {
    clearRuntimeStartupPlan();

    if (!account.farmEnabled) setFarmSubsystemEnabled(false);
    if (!account.friendEnabled) setFriendSubsystemEnabled(false);
    if (!account.taskEnabled) setTaskSubsystemEnabled(false);
    if (!account.sellEnabled) setSellSubsystemEnabled(false);

    const plan = buildLoginStartupPlan(account);
    const delayedPlan = plan.filter((item) => Number(item.delayMs) > 0);
    startupWarmupPendingCount = delayedPlan.length;
    startupWarmupActive = delayedPlan.length > 0;

    if (delayedPlan.length > 0) {
        const labels = {
            friend: '好友巡查',
            task: '任务/礼包',
            sell: '自动出售',
            sellDebug: '背包预检',
        };
        const summary = delayedPlan.map((item) => `${labels[item.key] || item.key} ${Math.round(item.delayMs / 1000)}s`).join(' / ');
        console.log(`[启动预热] 为避免登录后请求突刺，将分阶段启用：${summary}`);
    }

    for (const item of plan) {
        const delayMs = Math.max(0, Number(item.delayMs) || 0);
        if (delayMs === 0) {
            runRuntimeStartupStep(item.key, account);
            continue;
        }
        const timer = setTimeout(() => {
            startupWarmupTimers = startupWarmupTimers.filter((entry) => entry !== timer);
            runRuntimeStartupStep(item.key, account);
            finishRuntimeStartupStep();
        }, delayMs);
        startupWarmupTimers.push(timer);
    }
}

function stopRuntimeSubsystems() {
    clearRuntimeStartupPlan();
    setFarmSubsystemEnabled(false);
    setFriendSubsystemEnabled(false);
    setTaskSubsystemEnabled(false);
    setSellSubsystemEnabled(false);
    runtimeSubsystemsReady = false;
}

function applyRuntimeAccountSettings(patch = {}, options = {}) {
    const silent = Boolean(options.silent);
    const activateSubsystems = options.activateSubsystems !== false;
    const runtime = updateRuntimeAccountSettings(patch);
    const account = runtime.account || {};

    CONFIG.forceLowestLevelCrop = Boolean(account.forceLowestLevelCrop);
    updateFriendRuntimeSettings({
        helpOnlyWithExp: account.helpOnlyWithExp,
        enablePutBadThings: account.enablePutBadThings,
        friendStealEnabled: account.friendStealEnabled,
        friendHelpEnabled: account.friendHelpEnabled,
    });
    updateFarmRuntimeSettings({
        autoUnlockLands: account.autoUnlockLands,
        autoUpgradeLands: account.autoUpgradeLands,
        autoFertilize: account.autoFertilize,
        autoBuyFertilizer: account.autoBuyFertilizer,
        plantingStrategy: account.plantingStrategy,
        preferredSeedId: account.preferredSeedId,
    });
    updateTaskRuntimeSettings({
        taskActiveEnabled: account.taskActiveEnabled,
        giftEnabled: account.giftEnabled,
        vipGiftEnabled: account.vipGiftEnabled,
        monthCardEnabled: account.monthCardEnabled,
        openServerGiftEnabled: account.openServerGiftEnabled,
    });

    if (runtimeSubsystemsReady && activateSubsystems) {
        if (startupWarmupActive) {
            scheduleRuntimeSubsystemStartup(account);
        } else {
            setFarmSubsystemEnabled(Boolean(account.farmEnabled));
            setFriendSubsystemEnabled(Boolean(account.friendEnabled));
            setTaskSubsystemEnabled(Boolean(account.taskEnabled));
            setSellSubsystemEnabled(Boolean(account.sellEnabled));
        }
    }

    if (!silent) {
        emitProcessState('settingsUpdated', {
            scope: 'account',
            account,
        });
    }
    return account;
}

function applyRuntimeQrLoginSettings(patch = {}, options = {}) {
    const silent = Boolean(options.silent);
    const runtime = updateRuntimeQrLoginSettings(patch);
    if (!silent) {
        emitProcessState('settingsUpdated', {
            scope: 'qrLogin',
            qrLogin: runtime.qrLogin || {},
        });
    }
    return runtime.qrLogin || {};
}

async function beginAutoRelogin(reasonText) {
    if (reloginInProgress) return false;

    reloginInProgress = true;
    unexpectedWsClosing = true;
    stopRuntimeSubsystems();
    emitProcessState('starting', {
        mode: 'run',
        reason: 'relogin_qr',
    });
    emitUiEvent('qr', {
        phase: 'loading',
        message: '正在申请重登录二维码...',
    });

    markManualClose();
    const activeWs = getWs();
    if (activeWs) {
        try { activeWs.close(); } catch (e) { }
    }
    cleanup();

    const waitingMessage = reasonText
        ? `账号已下线，请扫码重新登录（${reasonText}）`
        : '账号已下线，请扫码重新登录';

    try {
        const nextCode = await getQQFarmCodeByScan({
            relogin: true,
            waitingMessage,
            onCodeReady: async ({ url, backupUrls }) => {
                const reminder = buildOfflineReloginReminder(reasonText, { url, backupUrls });
                await pushCriticalBarkWithTimeout(
                    reminder.title,
                    reminder.body,
                    reminder.dedupeKey,
                    {
                        category: 'network',
                        timeoutMs: 2500,
                        actionUrl: reminder.actionUrl,
                    }
                );
            },
        });
        emitProcessState('starting', {
            mode: 'run',
            reason: 'relogin_connect',
        });
        reconnect(nextCode);
        return true;
    } catch (err) {
        const detail = `自动重登录失败: ${formatErrorDetail(err)}`;
        emitUiEvent('qr', {
            phase: 'error',
            message: detail,
        });
        emitProcessState('error', {
            kind: 'relogin',
            fatal: true,
            message: detail,
        });
        await pushCriticalBarkWithTimeout(
            'QQ农场重登录失败',
            detail,
            `fatal:relogin:${detail}`,
            { category: 'fatal', timeoutMs: 2200 }
        );
        process.exit(1);
    } finally {
        reloginInProgress = false;
    }
}

function registerIpcHandlers() {
    process.on('message', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'settings:bark') {
            updateRuntimeBarkSettings(msg.payload || {});
            emitProcessState('settingsUpdated', { scope: 'bark' });
            return;
        }
        if (msg.type === 'settings:account') {
            applyRuntimeAccountSettings(msg.payload || {});
            return;
        }
        if (msg.type === 'settings:qrLogin') {
            applyRuntimeQrLoginSettings(msg.payload || {});
            return;
        }
        if (msg.type === 'rpc:req') {
            void handleRpcRequest(msg);
        }
    });
}

function registerNetworkLifecycleHandlers() {
    networkEvents.on('kickout', ({ reason } = {}) => {
        if (unexpectedWsClosing) return;
        const reasonText = String(reason || '').trim() || '未知原因';
        if (shouldAttemptAutoReconnectForKickout(reasonText)) {
            void beginAutoRelogin(reasonText);
            return;
        }

        unexpectedWsClosing = true;
        const message = `账号被踢下线 (${reasonText})`;
        emitProcessState('error', {
            kind: 'kickout',
            fatal: true,
            message,
        });
        stopRuntimeSubsystems();
        cleanup();
        void (async () => {
            await pushCriticalBarkWithTimeout(
                'QQ农场连接异常',
                message,
                `fatal:kickout:${reasonText}`,
                { category: 'fatal', timeoutMs: 2200 }
            );
            process.exit(1);
        })();
    });

    networkEvents.on('wsClosed', ({ code, reason, manual } = {}) => {
        if (manual || reloginInProgress || unexpectedWsClosing) return;
        unexpectedWsClosing = true;
        const reasonPart = reason ? `, reason=${reason}` : '';
        const message = `WS连接关闭 (code=${code || 0}${reasonPart})`;
        emitProcessState('starting', {
            mode: 'run',
            reason: 'ws_reconnect',
        });
        void pushCriticalBarkWithTimeout(
            'QQ农场连接异常',
            `${message}，准备自动重连`,
            `network:wsClosed:${message}`,
            { category: 'network', timeoutMs: 2200 }
        );
    });

    networkEvents.on('wsError', ({ code, message, manual } = {}) => {
        if (manual || reloginInProgress) return;
        if (!shouldAttemptAutoReloginForWsError({ code, message })) return;
        void beginAutoRelogin(message || `code=${code || 0}`);
    });
}

async function handleRpcRequest(msg) {
    const requestId = String(msg.requestId || '');
    const method = String(msg.method || '');
    const payload = msg.payload || {};
    if (!requestId || !process.send) return;

    try {
        let result = null;
        if (method === 'friends.list') {
            result = await listFriendsForUi();
        } else if (method === 'friends.op') {
            result = await runManualFriendOp(payload);
        } else if (method === 'farm.lands') {
            result = await listLandsForUi();
        } else if (method === 'bag.items') {
            result = await listBagForUi();
        } else if (method === 'task.dailyGifts') {
            result = await getDailyGiftOverview();
        } else if (method === 'task.dailyGifts.claim') {
            result = await claimDailyGiftByKey(payload.key);
        } else {
            throw new Error(`unsupported rpc method: ${method}`);
        }
        process.send({
            type: 'rpc:res',
            requestId,
            ok: true,
            payload: result,
        });
    } catch (e) {
        process.send({
            type: 'rpc:res',
            requestId,
            ok: false,
            error: e && e.message ? e.message : String(e),
        });
    }
}

let fatalExitInProgress = false;
function registerGlobalErrorHandlers() {
    process.on('unhandledRejection', (reason) => {
        const detail = formatErrorDetail(reason);
        console.error('[致命] unhandledRejection:', reason);
        emitProcessState('error', { kind: 'unhandledRejection', fatal: true, message: detail });
        void pushBark('QQ农场致命异常', `unhandledRejection: ${detail}`, `fatal:unhandledRejection:${detail}`, { category: 'fatal' });
    });

    process.on('uncaughtException', async (err) => {
        if (fatalExitInProgress) return;
        fatalExitInProgress = true;
        const detail = formatErrorDetail(err);
        console.error('[致命] uncaughtException:', err);
        emitProcessState('error', { kind: 'uncaughtException', fatal: true, message: detail });
        try {
            await pushBark('QQ农场致命异常', `uncaughtException: ${detail}`, `fatal:uncaughtException:${detail}`, { category: 'fatal' });
        } finally {
            process.exit(1);
        }
    });
}

function bootstrapRuntimeSettingsFromLocalFile() {
    const result = loadRuntimeSettingsFromLocalFile();
    if (!result.loaded) return;
    if (result.barkApplied) {
        console.log(`[配置] 已加载 Bark 运行时设置 (${result.filePath})`);
    }
    if (result.qrLoginApplied) {
        console.log(`[配置] 已加载二维码登录域名设置 (${result.filePath})`);
    }
}

// ============ 主函数 ============
async function main() {
    const args = process.argv.slice(2);
    const mode = getRunMode(args);
    let usedQrLogin = false;
    emitProcessState('starting', { mode });

    // 加载 proto 定义
    await loadProto();

    // 验证模式
    if (args.includes('--verify')) {
        await verifyMode();
        emitProcessState('stopped', { mode: 'verify', reason: 'completed' });
        return;
    }

    // 解码模式
    if (args.includes('--decode')) {
        await decodeMode(args);
        emitProcessState('stopped', { mode: 'decode', reason: 'completed' });
        return;
    }

    // 正常挂机模式
    const options = parseArgs(args);

    // QQ 平台支持扫码登录: 显式 --qr，或未传 --code 时自动触发
    if (!options.code && CONFIG.platform === 'qq' && (options.qrLogin || !args.includes('--code'))) {
        console.log('[扫码登录] 正在获取二维码...');
        options.code = await getQQFarmCodeByScan();
        usedQrLogin = true;
        console.log(`[扫码登录] 获取成功，code=${options.code.substring(0, 8)}...`);
    }

    if (!options.code) {
        if (CONFIG.platform === 'wx') {
            console.log('[参数] 微信模式仍需通过 --code 传入登录凭证');
        }
        showHelp();
        process.exit(1);
    }
    if (options.deleteAccountMode && (!options.name || !options.certId)) {
        console.log('[参数] 注销账号模式必须提供 --name 和 --cert-id');
        showHelp();
        process.exit(1);
    }

    // 扫码阶段结束后清屏，避免状态栏覆盖二维码区域导致界面混乱
    if (usedQrLogin && process.stdout.isTTY) {
        process.stdout.write('\x1b[2J\x1b[H');
    }

    // 初始化状态栏
    initStatusBar();
    setStatusPlatform(CONFIG.platform);
    emitRuntimeHint(true);

    const platformName = CONFIG.platform === 'wx' ? '微信' : 'QQ';
    console.log(`[启动] ${platformName} code=${options.code.substring(0, 8)}... 农场${CONFIG.farmCheckInterval / 1000}s 好友${CONFIG.friendCheckInterval / 1000}s`);

    // 连接并登录，登录成功后启动各功能模块
    connect(options.code, async () => {
        const recovered = runtimeSubsystemsReady;
        unexpectedWsClosing = false;
        if (recovered) {
            emitProcessState('running', { mode: 'run', recovered: true });
            return;
        }

        // 处理邀请码 (仅微信环境)
        await processInviteCodes();

        runtimeSubsystemsReady = true;
        const accountRuntime = applyRuntimeAccountSettings({}, { silent: true, activateSubsystems: false });
        scheduleRuntimeSubsystemStartup(accountRuntime);
        emitProcessState('running', { mode: 'run' });
    });

    // 退出处理
    process.on('SIGINT', () => {
        emitProcessState('stopping', { mode: 'run', reason: 'signal' });
        cleanupStatusBar();
        console.log('\n[退出] 正在断开...');
        stopRuntimeSubsystems();
        markManualClose();
        const ws = getWs();
        if (ws) ws.close();
        cleanup();
        emitProcessState('stopped', { mode: 'run', reason: 'signal' });
        process.exit(0);
    });
}

registerIpcHandlers();
registerGlobalErrorHandlers();
registerNetworkLifecycleHandlers();
bootstrapRuntimeSettingsFromLocalFile();

main().catch(async (err) => {
    console.error('启动失败:', err);
    const detail = formatErrorDetail(err);
    emitProcessState('error', { kind: 'startup', fatal: true, message: detail });
    await pushBark('QQ农场启动失败', detail, `fatal:startup:${detail}`, { category: 'fatal' });
    process.exit(1);
});
