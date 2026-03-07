const { sendMsgAsync } = require('./network');
const { types } = require('./proto');
const { log } = require('./utils');
const { getRewardSummary, isAlreadyClaimedError, createDailyCooldown, getDateKey } = require('./dailyCommon');

const DAILY_KEY = 'vip_daily_gift';
const dailyCooldown = createDailyCooldown({ cooldownMs: 10 * 60 * 1000 });
let doneDateKey = '';
let lastClaimAt = 0;
let lastResult = '';
let lastHasGift = null;
let lastCanClaim = null;

function markDoneToday() { doneDateKey = getDateKey(); }
function isDoneToday() { return doneDateKey === getDateKey(); }

async function getDailyGiftStatus() {
    const body = types.GetDailyGiftStatusRequest.encode(types.GetDailyGiftStatusRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.qqvippb.QQVipService', 'GetDailyGiftStatus', body);
    return types.GetDailyGiftStatusReply.decode(replyBody);
}

async function claimDailyGift() {
    const body = types.ClaimDailyGiftRequest.encode(types.ClaimDailyGiftRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.qqvippb.QQVipService', 'ClaimDailyGift', body);
    return types.ClaimDailyGiftReply.decode(replyBody);
}

async function peekVipDailyGiftState() {
    const status = await getDailyGiftStatus();
    return {
        hasGift: !!(status && status.has_gift),
        canClaim: !!(status && status.can_claim),
    };
}

async function performDailyVipGift(force = false) {
    if (!dailyCooldown.canRun(force)) return false;
    try {
        const status = await getDailyGiftStatus();
        lastHasGift = !!(status && status.has_gift);
        lastCanClaim = !!(status && status.can_claim);
        if (!lastCanClaim) {
            markDoneToday();
            dailyCooldown.markRan();
            lastResult = 'none';
            return false;
        }
        const reply = await claimDailyGift();
        const items = Array.isArray(reply && reply.items) ? reply.items : [];
        log('会员', getRewardSummary(items) || '领取成功');
        lastClaimAt = Date.now();
        lastResult = 'ok';
        markDoneToday();
        dailyCooldown.markRan();
        return true;
    } catch (e) {
        if (isAlreadyClaimedError(e)) {
            lastClaimAt = Date.now();
            lastResult = 'ok';
            markDoneToday();
            dailyCooldown.markRan();
            return false;
        }
        lastResult = 'error';
        log('会员', `领取会员礼包失败: ${e.message}`);
        return false;
    }
}

function getVipDailyState() {
    return {
        key: DAILY_KEY,
        doneToday: isDoneToday(),
        ...dailyCooldown.getState(),
        lastClaimAt,
        result: lastResult,
        hasGift: lastHasGift,
        canClaim: lastCanClaim,
    };
}

module.exports = {
    getDailyGiftStatus,
    claimDailyGift,
    peekVipDailyGiftState,
    performDailyVipGift,
    getVipDailyState,
};
