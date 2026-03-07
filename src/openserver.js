const { sendMsgAsync } = require('./network');
const { types } = require('./proto');
const { log } = require('./utils');
const { getRewardSummary, isAlreadyClaimedError, createDailyCooldown, getDateKey } = require('./dailyCommon');

const DAILY_KEY = 'open_server_gift';
const dailyCooldown = createDailyCooldown({ cooldownMs: 10 * 60 * 1000 });
let doneDateKey = '';
let lastClaimAt = 0;
let lastResult = '';
let lastHasClaimable = null;

function markDoneToday() { doneDateKey = getDateKey(); }
function isDoneToday() { return doneDateKey === getDateKey(); }

async function getTodayClaimStatus() {
    const body = types.GetTodayClaimStatusRequest.encode(types.GetTodayClaimStatusRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.redpacketpb.RedPacketService', 'GetTodayClaimStatus', body);
    return types.GetTodayClaimStatusReply.decode(replyBody);
}

async function claimRedPacket(id) {
    const body = types.ClaimRedPacketRequest.encode(types.ClaimRedPacketRequest.create({ id: Number(id) || 0 })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.redpacketpb.RedPacketService', 'ClaimRedPacket', body);
    return types.ClaimRedPacketReply.decode(replyBody);
}

async function peekOpenServerState() {
    const reply = await getTodayClaimStatus();
    const infos = Array.isArray(reply && reply.infos) ? reply.infos : [];
    const claimable = infos.filter((item) => item && item.can_claim && Number(item.id || 0) > 0);
    return { hasClaimable: claimable.length > 0 };
}

async function performDailyOpenServerGift(force = false) {
    if (!dailyCooldown.canRun(force)) return false;
    try {
        const reply = await getTodayClaimStatus();
        const infos = Array.isArray(reply && reply.infos) ? reply.infos : [];
        const claimable = infos.filter((item) => item && item.can_claim && Number(item.id || 0) > 0);
        lastHasClaimable = claimable.length > 0;
        if (claimable.length === 0) {
            markDoneToday();
            dailyCooldown.markRan();
            lastResult = 'none';
            return false;
        }
        let claimed = 0;
        for (const item of claimable) {
            try {
                const ret = await claimRedPacket(item.id);
                log('开服', getRewardSummary(ret.item ? [ret.item] : []) || '领取成功');
                claimed += 1;
            } catch (e) {
                if (isAlreadyClaimedError(e)) {
                    markDoneToday();
                    dailyCooldown.markRan();
                    lastResult = 'ok';
                    return false;
                }
            }
        }
        lastClaimAt = Date.now();
        lastResult = claimed > 0 ? 'ok' : 'none';
        markDoneToday();
        dailyCooldown.markRan();
        return claimed > 0;
    } catch (e) {
        lastResult = 'error';
        log('开服', `领取开服红包失败: ${e.message}`);
        return false;
    }
}

function getOpenServerDailyState() {
    return {
        key: DAILY_KEY,
        doneToday: isDoneToday(),
        ...dailyCooldown.getState(),
        lastClaimAt,
        result: lastResult,
        hasClaimable: lastHasClaimable,
    };
}

module.exports = {
    getTodayClaimStatus,
    claimRedPacket,
    peekOpenServerState,
    performDailyOpenServerGift,
    getOpenServerDailyState,
};
