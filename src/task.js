/**
 * 任务系统 - 自动领取任务奖励
 */

const protobuf = require('protobufjs');
const { types } = require('./proto');
const { sendMsgAsync, networkEvents } = require('./network');
const { toLong, toNum, log, logWarn, sleep } = require('./utils');
const { getItemName } = require('./gameConfig');

const DEFAULT_TASK_RUNTIME_SETTINGS = {
    taskActiveEnabled: true,
    giftEnabled: true,
};
let taskRuntimeSettings = { ...DEFAULT_TASK_RUNTIME_SETTINGS };
let activeClaimSupport = 'unknown';
let activeClaimWarned = false;
let taskCheckInProgress = false;
let taskPollTimer = null;
let taskNotifyTimer = null;
const TASK_POLL_INTERVAL_MS = 60 * 1000;

function updateTaskRuntimeSettings(patch = {}) {
    taskRuntimeSettings = {
        ...taskRuntimeSettings,
        ...patch,
    };
    taskRuntimeSettings.taskActiveEnabled = Boolean(taskRuntimeSettings.taskActiveEnabled);
    taskRuntimeSettings.giftEnabled = Boolean(taskRuntimeSettings.giftEnabled);
    return { ...taskRuntimeSettings };
}

function getTaskRuntimeSettings() {
    return { ...taskRuntimeSettings };
}

function isMethodUnsupportedError(err) {
    const text = String((err && err.message) || '').toLowerCase();
    return text.includes('method') && (text.includes('not') || text.includes('unknown') || text.includes('unsupported') || text.includes('unimplemented'));
}

function encodeSingleInt64Field(fieldNo, value) {
    const writer = protobuf.Writer.create();
    writer.uint32((fieldNo << 3) | 0).int64(toLong(value));
    return writer.finish();
}

// ============ 任务 API ============

async function getTaskInfo() {
    const body = types.TaskInfoRequest.encode(types.TaskInfoRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.taskpb.TaskService', 'TaskInfo', body);
    return types.TaskInfoReply.decode(replyBody);
}

async function claimTaskReward(taskId, doShared = false) {
    const body = types.ClaimTaskRewardRequest.encode(types.ClaimTaskRewardRequest.create({
        id: toLong(taskId),
        do_shared: doShared,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.taskpb.TaskService', 'ClaimTaskReward', body);
    return types.ClaimTaskRewardReply.decode(replyBody);
}

async function claimTaskRewardWithFallback(task) {
    const useSharedFirst = toNum(task.shareMultiple) > 1;
    if (!useSharedFirst) {
        const reply = await claimTaskReward(task.id, false);
        return { reply, mode: 'normal', fallback: false };
    }
    try {
        const reply = await claimTaskReward(task.id, true);
        return { reply, mode: 'shared', fallback: false };
    } catch (shareErr) {
        try {
            const reply = await claimTaskReward(task.id, false);
            return { reply, mode: 'normal', fallback: true, shareErr };
        } catch (normalErr) {
            normalErr.shareErr = shareErr;
            throw normalErr;
        }
    }
}

async function batchClaimTaskReward(taskIds, doShared = false) {
    const body = types.BatchClaimTaskRewardRequest.encode(types.BatchClaimTaskRewardRequest.create({
        ids: taskIds.map(id => toLong(id)),
        do_shared: doShared,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.taskpb.TaskService', 'BatchClaimTaskReward', body);
    return types.BatchClaimTaskRewardReply.decode(replyBody);
}

async function getBag() {
    const body = types.BagRequest.encode(types.BagRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Bag', body);
    return types.BagReply.decode(replyBody);
}

function getBagItems(bagReply) {
    if (bagReply.item_bag && Array.isArray(bagReply.item_bag.items)) return bagReply.item_bag.items;
    if (Array.isArray(bagReply.items)) return bagReply.items;
    return [];
}

async function useBagItem(itemId, count = 1) {
    const body = types.UseRequest.encode(types.UseRequest.create({
        item_id: toLong(itemId),
        count: toLong(count),
        land_ids: [],
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Use', body);
    return types.UseReply.decode(replyBody);
}

async function claimActiveReward(activeId) {
    const methods = [
        'ClaimActiveReward',
        'ClaimActive',
        'ClaimTaskActiveReward',
    ];
    let lastErr = null;
    for (const method of methods) {
        try {
            const body = encodeSingleInt64Field(1, activeId);
            await sendMsgAsync('gamepb.taskpb.TaskService', method, body);
            activeClaimSupport = 'supported';
            return;
        } catch (e) {
            lastErr = e;
            if (isMethodUnsupportedError(e)) {
                continue;
            }
            throw e;
        }
    }
    activeClaimSupport = 'unsupported';
    throw lastErr || new Error('claim active reward failed');
}

// ============ 任务分析 ============

/**
 * 分析任务列表，找出可领取的任务
 */
function analyzeTaskList(tasks) {
    const claimable = [];
    for (const task of tasks) {
        const id = toNum(task.id);
        const progress = toNum(task.progress);
        const totalProgress = toNum(task.total_progress);
        const isClaimed = task.is_claimed;
        const isUnlocked = task.is_unlocked;
        const shareMultiple = toNum(task.share_multiple);

        // 可领取条件: 已解锁 + 未领取 + 进度完成
        if (isUnlocked && !isClaimed && progress >= totalProgress && totalProgress > 0) {
            claimable.push({
                id,
                desc: task.desc || `任务#${id}`,
                shareMultiple,
                rewards: task.rewards || [],
            });
        }
    }
    return claimable;
}

function pickClaimableActives(actives) {
    const picked = [];
    for (const active of (actives || [])) {
        const status = toNum(active.status);
        const id = toNum(active.id);
        if (id > 0 && status === 1) {
            picked.push(id);
        }
    }
    return picked;
}

function pickGiftItems(items) {
    const out = [];
    const regex = /(礼包|礼盒|宝箱|盲盒|补给箱)/;
    for (const item of (items || [])) {
        const id = toNum(item.id);
        const count = toNum(item.count);
        const name = String(item.name || getItemName(id) || '');
        if (id <= 0 || count <= 0) continue;
        if (!regex.test(name)) continue;
        out.push({ id, count, name });
    }
    return out;
}

/**
 * 计算奖励摘要
 */
function getRewardSummary(items) {
    const summary = [];
    for (const item of items) {
        const id = toNum(item.id);
        const count = toNum(item.count);
        // 常见物品ID: 1=金币, 2=经验
        if (id === 1) summary.push(`金币${count}`);
        else if (id === 2) summary.push(`经验${count}`);
        else summary.push(`${getItemName(id)}(${id})x${count}`);
    }
    return summary.join('/');
}

async function claimActiveRewards(taskInfo) {
    if (!taskRuntimeSettings.taskActiveEnabled) return;
    if (!taskInfo) return;
    if (activeClaimSupport === 'unsupported') return;
    const activeIds = pickClaimableActives(taskInfo.actives || []);
    if (activeIds.length === 0) return;

    for (const activeId of activeIds) {
        try {
            await claimActiveReward(activeId);
            log('任务', `领取活跃礼包 #${activeId} 成功`);
            await sleep(180);
        } catch (e) {
            if (isMethodUnsupportedError(e)) {
                activeClaimSupport = 'unsupported';
                if (!activeClaimWarned) {
                    activeClaimWarned = true;
                    logWarn('任务', '当前协议未识别活跃礼包领取接口，后续自动跳过');
                }
                return;
            }
            logWarn('任务', `领取活跃礼包 #${activeId} 失败: ${e.message}`);
        }
    }
}

async function openGiftPacks() {
    if (!taskRuntimeSettings.giftEnabled) return;

    try {
        const bagReply = await getBag();
        const items = getBagItems(bagReply).map((item) => ({
            id: toNum(item.id),
            count: toNum(item.count),
            name: getItemName(toNum(item.id)),
        }));
        const gifts = pickGiftItems(items);
        if (gifts.length === 0) return;

        for (const gift of gifts) {
            const tryCount = Math.min(gift.count, 5);
            for (let i = 0; i < tryCount; i++) {
                try {
                    await useBagItem(gift.id, 1);
                    log('礼包', `开启 ${gift.name}(${gift.id})`);
                    await sleep(120);
                } catch (e) {
                    logWarn('礼包', `开启 ${gift.name}(${gift.id}) 失败: ${e.message}`);
                    break;
                }
            }
        }
    } catch (e) {
        logWarn('礼包', `读取背包失败: ${e.message}`);
    }
}

// ============ 自动领取 ============

/**
 * 检查并领取所有可领取的任务奖励
 */
async function checkAndClaimTasks() {
    if (taskCheckInProgress) return;
    taskCheckInProgress = true;
    try {
        const reply = await getTaskInfo();
        if (!reply.task_info) return;

        const taskInfo = reply.task_info;
        const allTasks = [
            ...(taskInfo.growth_tasks || []),
            ...(taskInfo.daily_tasks || []),
            ...(taskInfo.tasks || []),
        ];

        const claimable = analyzeTaskList(allTasks);
        const claimableActives = pickClaimableActives(taskInfo.actives || []);
        if (claimable.length > 0) {
            log('任务', `发现 ${claimable.length} 个可领取任务`);
            await claimTasksFromList(claimable);
        }
        if (claimableActives.length > 0 || claimable.length > 0) {
            await claimActiveRewards(taskInfo);
        }
        await openGiftPacks();
    } catch (e) {
        logWarn('任务', `检查任务失败: ${e.message}`);
    } finally {
        taskCheckInProgress = false;
    }
}

/**
 * 处理任务状态变化推送
 */
function onTaskInfoNotify(taskInfo) {
    if (!taskInfo) return;

    const allTasks = [
        ...(taskInfo.growth_tasks || []),
        ...(taskInfo.daily_tasks || []),
        ...(taskInfo.tasks || []),
    ];

    const claimable = analyzeTaskList(allTasks);
    const claimableActives = pickClaimableActives(taskInfo.actives || []);
    if (claimable.length === 0 && claimableActives.length === 0) return;

    // 有可领取任务，延迟后触发一次完整检查（避免并发与旧快照）
    const parts = [];
    if (claimable.length > 0) parts.push(`任务${claimable.length}`);
    if (claimableActives.length > 0) parts.push(`活跃礼包${claimableActives.length}`);
    log('任务', `有 ${parts.join('、')} 可领取，准备自动领取...`);
    if (taskNotifyTimer) {
        clearTimeout(taskNotifyTimer);
    }
    taskNotifyTimer = setTimeout(() => {
        taskNotifyTimer = null;
        void checkAndClaimTasks();
    }, 1000);
}

/**
 * 从任务列表领取奖励
 */
async function claimTasksFromList(claimable) {
    for (const task of claimable) {
        try {
            const claimed = await claimTaskRewardWithFallback(task);
            const multipleStr = claimed.mode === 'shared' ? ` (${task.shareMultiple}倍)` : '';
            const claimReply = claimed.reply;
            const items = claimReply.items || [];
            const rewardStr = items.length > 0 ? getRewardSummary(items) : '无';

            log('任务', `领取: ${task.desc}${multipleStr} → ${rewardStr}`);
            if (claimed.fallback) {
                logWarn('任务', `任务#${task.id} 分享领取失败，已回退普通领取`);
            }
            await sleep(300);
        } catch (e) {
            logWarn('任务', `领取失败 #${task.id}: ${e.message}`);
        }
    }
}

// ============ 初始化 ============

function initTaskSystem() {
    // 监听任务状态变化推送
    networkEvents.on('taskInfoNotify', onTaskInfoNotify);

    // 启动时检查一次任务
    setTimeout(() => checkAndClaimTasks(), 4000);
    if (taskPollTimer) clearInterval(taskPollTimer);
    taskPollTimer = setInterval(() => {
        void checkAndClaimTasks();
    }, TASK_POLL_INTERVAL_MS);
}

function cleanupTaskSystem() {
    networkEvents.off('taskInfoNotify', onTaskInfoNotify);
    if (taskNotifyTimer) {
        clearTimeout(taskNotifyTimer);
        taskNotifyTimer = null;
    }
    if (taskPollTimer) {
        clearInterval(taskPollTimer);
        taskPollTimer = null;
    }
    taskCheckInProgress = false;
}

module.exports = {
    checkAndClaimTasks,
    initTaskSystem,
    cleanupTaskSystem,
    updateTaskRuntimeSettings,
    getTaskRuntimeSettings,
    __private: {
        pickClaimableActives,
        pickGiftItems,
    },
};
