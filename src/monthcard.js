const { sendMsgAsync } = require('./network');
const { types } = require('./proto');
const { log } = require('./utils');
const { getRewardSummary, createDailyCooldown, getDateKey } = require('./dailyCommon');

const DAILY_KEY = 'month_card_gift';
const dailyCooldown = createDailyCooldown({ cooldownMs: 10 * 60 * 1000 });
let doneDateKey = '';
let lastClaimAt = 0;
let lastResult = '';
let lastHasCard = null;
let lastHasClaimable = null;

function markDoneToday() { doneDateKey = getDateKey(); }
function isDoneToday() { return doneDateKey === getDateKey(); }

async function getMonthCardInfos() {
    const body = types.GetMonthCardInfosRequest.encode(types.GetMonthCardInfosRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'GetMonthCardInfos', body);
    return types.GetMonthCardInfosReply.decode(replyBody);
}

async function claimMonthCardReward(goodsId) {
    const body = types.ClaimMonthCardRewardRequest.encode(types.ClaimMonthCardRewardRequest.create({ goods_id: Number(goodsId) || 0 })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'ClaimMonthCardReward', body);
    return types.ClaimMonthCardRewardReply.decode(replyBody);
}

async function peekMonthCardState() {
    const reply = await getMonthCardInfos();
    const infos = Array.isArray(reply && reply.infos) ? reply.infos : [];
    const claimable = infos.filter((item) => item && item.can_claim && Number(item.goods_id || 0) > 0);
    return {
        hasCard: infos.length > 0,
        hasClaimable: claimable.length > 0,
    };
}

async function performDailyMonthCardGift(force = false) {
    if (!dailyCooldown.canRun(force)) return false;
    try {
        const reply = await getMonthCardInfos();
        const infos = Array.isArray(reply && reply.infos) ? reply.infos : [];
        lastHasCard = infos.length > 0;
        const claimable = infos.filter((item) => item && item.can_claim && Number(item.goods_id || 0) > 0);
        lastHasClaimable = claimable.length > 0;
        if (claimable.length === 0) {
            markDoneToday();
            dailyCooldown.markRan();
            lastResult = 'none';
            return false;
        }
        let claimed = 0;
        for (const item of claimable) {
            const rep = await claimMonthCardReward(item.goods_id);
            log('月卡', getRewardSummary(rep.items || []) || '领取成功');
            claimed += 1;
        }
        lastClaimAt = Date.now();
        lastResult = claimed > 0 ? 'ok' : 'none';
        markDoneToday();
        dailyCooldown.markRan();
        return claimed > 0;
    } catch (e) {
        lastResult = 'error';
        log('月卡', `领取月卡礼包失败: ${e.message}`);
        return false;
    }
}

function getMonthCardDailyState() {
    return {
        key: DAILY_KEY,
        doneToday: isDoneToday(),
        ...dailyCooldown.getState(),
        lastClaimAt,
        result: lastResult,
        hasCard: lastHasCard,
        hasClaimable: lastHasClaimable,
    };
}

module.exports = {
    getMonthCardInfos,
    claimMonthCardReward,
    peekMonthCardState,
    performDailyMonthCardGift,
    getMonthCardDailyState,
};
