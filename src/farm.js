/**
 * 自己的农场操作 - 收获/浇水/除草/除虫/铲除/种植/商店/巡田
 */

const protobuf = require('protobufjs');
const { CONFIG, PlantPhase, PHASE_NAMES } = require('./config');
const { types } = require('./proto');
const { sendMsgAsync, getUserState, networkEvents } = require('./network');
const { toLong, toNum, getServerTimeSec, toTimeSec, log, logWarn, sleep } = require('./utils');
const { getPlantNameBySeedId, getPlantName, getPlantExp, formatGrowTime, getPlantGrowTime, getItemName } = require('./gameConfig');
const { getPlantingRecommendation } = require('../tools/calc-exp-yield');
const { buildBestCropPair } = require('./cropAdvisor');
const { emitUiEvent, isUiEventsEnabled } = require('./uiEvents');
const { pickAvailableSeedByStrategy } = require('./analytics');

// ============ 内部状态 ============
let isCheckingFarm = false;
let isFirstFarmCheck = true;
let farmCheckTimer = null;
let farmLoopRunning = false;

const DEFAULT_FARM_RUNTIME_SETTINGS = {
    autoUnlockLands: true,
    autoUpgradeLands: true,
    autoFertilize: true,
    autoBuyFertilizer: true,
    plantingStrategy: 'preferred',
    preferredSeedId: 0,
};
let farmRuntimeSettings = { ...DEFAULT_FARM_RUNTIME_SETTINGS };

function updateFarmRuntimeSettings(patch = {}) {
    farmRuntimeSettings = {
        ...farmRuntimeSettings,
        ...patch,
    };
    farmRuntimeSettings.autoUnlockLands = Boolean(farmRuntimeSettings.autoUnlockLands);
    farmRuntimeSettings.autoUpgradeLands = Boolean(farmRuntimeSettings.autoUpgradeLands);
    farmRuntimeSettings.autoFertilize = Boolean(farmRuntimeSettings.autoFertilize);
    farmRuntimeSettings.autoBuyFertilizer = Boolean(farmRuntimeSettings.autoBuyFertilizer);
    const allowedStrategies = new Set(['preferred', 'level', 'max_exp', 'max_fert_exp', 'max_profit', 'max_fert_profit']);
    const plantingStrategy = String(farmRuntimeSettings.plantingStrategy || 'preferred').trim();
    farmRuntimeSettings.plantingStrategy = allowedStrategies.has(plantingStrategy) ? plantingStrategy : 'preferred';
    farmRuntimeSettings.preferredSeedId = Math.max(0, Number.parseInt(farmRuntimeSettings.preferredSeedId, 10) || 0);
    return { ...farmRuntimeSettings };
}

function getFarmRuntimeSettings() {
    return { ...farmRuntimeSettings };
}

// ============ 农场 API ============

// 操作限制更新回调 (由 friend.js 设置)
let onOperationLimitsUpdate = null;
function setOperationLimitsCallback(callback) {
    onOperationLimitsUpdate = callback;
}

async function getAllLands() {
    const body = types.AllLandsRequest.encode(types.AllLandsRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'AllLands', body);
    const reply = types.AllLandsReply.decode(replyBody);
    // 更新操作限制
    if (reply.operation_limits && onOperationLimitsUpdate) {
        onOperationLimitsUpdate(reply.operation_limits);
    }
    return reply;
}

async function harvest(landIds) {
    const state = getUserState();
    const body = types.HarvestRequest.encode(types.HarvestRequest.create({
        land_ids: landIds,
        host_gid: toLong(state.gid),
        is_all: true,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Harvest', body);
    return types.HarvestReply.decode(replyBody);
}

async function waterLand(landIds) {
    const state = getUserState();
    const body = types.WaterLandRequest.encode(types.WaterLandRequest.create({
        land_ids: landIds,
        host_gid: toLong(state.gid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'WaterLand', body);
    return types.WaterLandReply.decode(replyBody);
}

async function weedOut(landIds) {
    const state = getUserState();
    const body = types.WeedOutRequest.encode(types.WeedOutRequest.create({
        land_ids: landIds,
        host_gid: toLong(state.gid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'WeedOut', body);
    return types.WeedOutReply.decode(replyBody);
}

async function insecticide(landIds) {
    const state = getUserState();
    const body = types.InsecticideRequest.encode(types.InsecticideRequest.create({
        land_ids: landIds,
        host_gid: toLong(state.gid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Insecticide', body);
    return types.InsecticideReply.decode(replyBody);
}

// 普通肥料 ID
const NORMAL_FERTILIZER_ID = 1011;
const FERTILIZER_MIN_BUY = 30;
const SHOP_CACHE_TTL_MS = 5 * 60 * 1000;

const LAND_ACTION_SUPPORT = {
    unlock: 'unknown',
    upgrade: 'unknown',
};
const LAND_ACTION_METHODS = {
    unlock: ['UnlockLand', 'Unlock', 'UnlockLands'],
    upgrade: ['UpgradeLand', 'Upgrade', 'UpgradeLands'],
};
let fertilizerGoodsCache = {
    expiresAt: 0,
    goodsId: 0,
    price: 0,
    itemCount: 1,
};

/**
 * 施肥 - 必须逐块进行，服务器不支持批量
 * 游戏中拖动施肥间隔很短，这里用 50ms
 */
async function fertilize(landIds, fertilizerId = NORMAL_FERTILIZER_ID) {
    let successCount = 0;
    for (const landId of landIds) {
        try {
            const body = types.FertilizeRequest.encode(types.FertilizeRequest.create({
                land_ids: [toLong(landId)],
                fertilizer_id: toLong(fertilizerId),
            })).finish();
            await sendMsgAsync('gamepb.plantpb.PlantService', 'Fertilize', body);
            successCount++;
        } catch (e) {
            // 施肥失败（可能肥料不足），停止继续
            break;
        }
        if (landIds.length > 1) await sleep(50);  // 50ms 间隔
    }
    return successCount;
}

async function removePlant(landIds) {
    const body = types.RemovePlantRequest.encode(types.RemovePlantRequest.create({
        land_ids: landIds.map(id => toLong(id)),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'RemovePlant', body);
    return types.RemovePlantReply.decode(replyBody);
}

// ============ 商店 API ============

async function getShopInfo(shopId) {
    const body = types.ShopInfoRequest.encode(types.ShopInfoRequest.create({
        shop_id: toLong(shopId),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.shoppb.ShopService', 'ShopInfo', body);
    return types.ShopInfoReply.decode(replyBody);
}

async function buyGoods(goodsId, num, price) {
    const body = types.BuyGoodsRequest.encode(types.BuyGoodsRequest.create({
        goods_id: toLong(goodsId),
        num: toLong(num),
        price: toLong(price),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.shoppb.ShopService', 'BuyGoods', body);
    return types.BuyGoodsReply.decode(replyBody);
}

async function getShopProfiles() {
    const body = types.ShopProfilesRequest.encode(types.ShopProfilesRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.shoppb.ShopService', 'ShopProfiles', body);
    return types.ShopProfilesReply.decode(replyBody);
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

function countBagItem(items, itemId) {
    for (const item of items) {
        if (toNum(item.id) === itemId) return toNum(item.count);
    }
    return 0;
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

function encodePackedInt64Field(fieldNo, values = []) {
    const writer = protobuf.Writer.create();
    const fork = writer.uint32((fieldNo << 3) | 2).fork();
    for (const v of values) fork.int64(toLong(v));
    fork.ldelim();
    return writer.finish();
}

async function sendLandActionRequest(action, landId) {
    const methods = LAND_ACTION_METHODS[action] || [];
    const payloadBuilders = [
        () => encodeSingleInt64Field(1, landId),
        () => encodePackedInt64Field(1, [landId]),
        () => encodeSingleInt64Field(2, landId),
    ];
    let lastErr = null;
    let unsupportedCount = 0;
    for (const method of methods) {
        for (const buildBody of payloadBuilders) {
            try {
                const body = buildBody();
                const ret = await sendMsgAsync('gamepb.plantpb.PlantService', method, body);
                LAND_ACTION_SUPPORT[action] = 'supported';
                return ret;
            } catch (e) {
                lastErr = e;
                if (isMethodUnsupportedError(e)) {
                    unsupportedCount++;
                    continue;
                }
                throw e;
            }
        }
    }
    if (unsupportedCount > 0 && methods.length > 0) {
        LAND_ACTION_SUPPORT[action] = 'unsupported';
    }
    throw lastErr || new Error(`${action} failed`);
}

function pickLandActionTargets(lands = []) {
    const unlockLandIds = [];
    const upgradeLandIds = [];
    for (const land of lands || []) {
        const id = toNum(land && land.id);
        if (!id) continue;
        const unlocked = Boolean(land && land.unlocked);
        const couldUnlock = Boolean(land && land.could_unlock);
        const couldUpgrade = Boolean(land && land.could_upgrade);
        const level = toNum(land && land.level);
        const maxLevel = toNum(land && land.max_level);
        if (!unlocked && couldUnlock) {
            unlockLandIds.push(id);
            continue;
        }
        if (unlocked && couldUpgrade && (maxLevel <= 0 || level < maxLevel)) {
            upgradeLandIds.push(id);
        }
    }
    return { unlockLandIds, upgradeLandIds };
}

async function tryAutoUnlockAndUpgradeLands(lands = []) {
    const { unlockLandIds, upgradeLandIds } = pickLandActionTargets(lands);

    if (farmRuntimeSettings.autoUnlockLands && LAND_ACTION_SUPPORT.unlock !== 'unsupported' && unlockLandIds.length > 0) {
        let ok = 0;
        for (const landId of unlockLandIds) {
            try {
                await sendLandActionRequest('unlock', landId);
                ok++;
                await sleep(120);
            } catch (e) {
                if (isMethodUnsupportedError(e)) {
                    LAND_ACTION_SUPPORT.unlock = 'unsupported';
                    logWarn('土地', '当前协议未识别到解锁接口，自动解锁已跳过');
                    break;
                }
                logWarn('土地', `解锁土地#${landId} 失败: ${e.message}`);
            }
        }
        if (ok > 0) {
            log('土地', `自动解锁 ${ok} 块土地`);
        }
    }

    if (farmRuntimeSettings.autoUpgradeLands && LAND_ACTION_SUPPORT.upgrade !== 'unsupported' && upgradeLandIds.length > 0) {
        let ok = 0;
        for (const landId of upgradeLandIds) {
            try {
                await sendLandActionRequest('upgrade', landId);
                ok++;
                await sleep(120);
            } catch (e) {
                if (isMethodUnsupportedError(e)) {
                    LAND_ACTION_SUPPORT.upgrade = 'unsupported';
                    logWarn('土地', '当前协议未识别到升级接口，自动升级已跳过');
                    break;
                }
                logWarn('土地', `升级土地#${landId} 失败: ${e.message}`);
            }
        }
        if (ok > 0) {
            log('土地', `自动升级 ${ok} 块土地`);
        }
    }
}

async function resolveFertilizerGoods() {
    const now = Date.now();
    if (fertilizerGoodsCache.goodsId > 0 && fertilizerGoodsCache.expiresAt > now) {
        return { ...fertilizerGoodsCache };
    }
    let picked = null;
    const profilesReply = await getShopProfiles();
    const profiles = profilesReply.shop_profiles || [];
    for (const profile of profiles) {
        const shopId = toNum(profile.shop_id);
        if (!shopId) continue;
        let info;
        try {
            info = await getShopInfo(shopId);
        } catch (e) {
            continue;
        }
        for (const goods of (info.goods_list || [])) {
            if (!goods.unlocked) continue;
            if (toNum(goods.item_id) !== NORMAL_FERTILIZER_ID) continue;
            const limitCount = toNum(goods.limit_count);
            const boughtNum = toNum(goods.bought_num);
            if (limitCount > 0 && boughtNum >= limitCount) continue;
            const candidate = {
                goodsId: toNum(goods.id),
                price: toNum(goods.price),
                itemCount: Math.max(1, toNum(goods.item_count)),
                expiresAt: now + SHOP_CACHE_TTL_MS,
            };
            if (!picked || candidate.price < picked.price) {
                picked = candidate;
            }
        }
    }
    if (!picked) return null;
    fertilizerGoodsCache = picked;
    return { ...picked };
}

async function ensureFertilizerStock(requiredCount) {
    const safeRequired = Math.max(0, Number.parseInt(requiredCount, 10) || 0);
    if (safeRequired <= 0) return 0;

    const bagReply = await getBag();
    const items = getBagItems(bagReply);
    const current = countBagItem(items, NORMAL_FERTILIZER_ID);
    if (current >= safeRequired || !farmRuntimeSettings.autoBuyFertilizer) {
        return current;
    }
    const toBuy = Math.max(FERTILIZER_MIN_BUY, safeRequired - current);
    const goods = await resolveFertilizerGoods();
    if (!goods || !goods.goodsId || goods.price <= 0) {
        return current;
    }
    const buyNum = Math.ceil(toBuy / Math.max(1, goods.itemCount));
    await buyGoods(goods.goodsId, buyNum, goods.price);
    log('施肥', `自动补充普通肥料 x${buyNum * goods.itemCount}`);
    return current + (buyNum * goods.itemCount);
}

// ============ 种植 ============

function encodePlantRequest(seedId, landIds) {
    const writer = protobuf.Writer.create();
    const itemWriter = writer.uint32(18).fork();
    itemWriter.uint32(8).int64(seedId);
    const idsWriter = itemWriter.uint32(18).fork();
    for (const id of landIds) {
        idsWriter.int64(id);
    }
    idsWriter.ldelim();
    itemWriter.ldelim();
    return writer.finish();
}

/**
 * 种植 - 游戏中拖动种植间隔很短，这里用 50ms
 */
async function plantSeeds(seedId, landIds) {
    let successCount = 0;
    for (const landId of landIds) {
        try {
            const body = encodePlantRequest(seedId, [landId]);
            const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Plant', body);
            types.PlantReply.decode(replyBody);
            successCount++;
        } catch (e) {
            logWarn('种植', `土地#${landId} 失败: ${e.message}`);
        }
        if (landIds.length > 1) await sleep(50);  // 50ms 间隔
    }
    return successCount;
}

async function findBestSeed(landsCount) {
    const SEED_SHOP_ID = 2;
    const shopReply = await getShopInfo(SEED_SHOP_ID);
    if (!shopReply.goods_list || shopReply.goods_list.length === 0) {
        logWarn('商店', '种子商店无商品');
        return null;
    }

    const state = getUserState();
    const safeLandsCount = landsCount == null ? 18 : landsCount;
    const levelBestPair = isUiEventsEnabled()
        ? buildBestCropPair({
            level: state.level || 1,
            landsCount: safeLandsCount,
        })
        : { currentLevelBest: null, nextLevelBest: null };
    const available = [];
    for (const goods of shopReply.goods_list) {
        if (!goods.unlocked) continue;

        let meetsConditions = true;
        let requiredLevel = 0;
        const conds = goods.conds || [];
        for (const cond of conds) {
            if (toNum(cond.type) === 1) {
                requiredLevel = toNum(cond.param);
                if (state.level < requiredLevel) {
                    meetsConditions = false;
                    break;
                }
            }
        }
        if (!meetsConditions) continue;

        const limitCount = toNum(goods.limit_count);
        const boughtNum = toNum(goods.bought_num);
        if (limitCount > 0 && boughtNum >= limitCount) continue;

        available.push({
            goods,
            goodsId: toNum(goods.id),
            seedId: toNum(goods.item_id),
            price: toNum(goods.price),
            requiredLevel,
        });
    }

    if (available.length === 0) {
        logWarn('商店', '没有可购买的种子');
        return null;
    }

    if (CONFIG.forceLowestLevelCrop) {
        available.sort((a, b) => a.requiredLevel - b.requiredLevel || a.price - b.price);
        const picked = available[0];
        emitUiEvent('bestCrop', {
            source: 'forceLowestLevelCrop',
            level: state.level,
            landsCount: safeLandsCount,
            seedId: picked.seedId,
            seedName: getPlantNameBySeedId(picked.seedId),
            requiredLevel: picked.requiredLevel,
            price: picked.price,
            currentLevelBest: levelBestPair.currentLevelBest,
            nextLevelBest: levelBestPair.nextLevelBest,
        });
        return picked;
    }

    try {
        log('商店', `等级: ${state.level}，土地数量: ${safeLandsCount}`);
        const picked = pickAvailableSeedByStrategy({
            available,
            strategy: farmRuntimeSettings.plantingStrategy,
            preferredSeedId: farmRuntimeSettings.preferredSeedId,
        });
        if (picked) {
            let recommendation = null;
            try {
                const rec = getPlantingRecommendation(state.level, safeLandsCount, { top: 50 });
                recommendation = (rec.candidatesNormalFert || []).find((item) => item.seedId === picked.seedId) || null;
            } catch (e) {
                recommendation = picked.metric || null;
            }
            emitUiEvent('bestCrop', {
                source: picked.source || 'strategy',
                strategy: farmRuntimeSettings.plantingStrategy,
                preferredSeedId: farmRuntimeSettings.preferredSeedId,
                level: state.level,
                landsCount: safeLandsCount,
                seedId: picked.seedId,
                seedName: getPlantNameBySeedId(picked.seedId),
                requiredLevel: picked.requiredLevel,
                price: picked.price,
                expPerHour: recommendation ? recommendation.expPerHour : undefined,
                profitPerHour: recommendation ? recommendation.profitPerHour : undefined,
                currentLevelBest: levelBestPair.currentLevelBest,
                nextLevelBest: levelBestPair.nextLevelBest,
            });
            return picked;
        }
    } catch (e) {
        logWarn('商店', `按策略选种失败，使用兜底策略: ${e.message}`);
    }

    const fallback = [...available].sort((a, b) => b.requiredLevel - a.requiredLevel || a.price - b.price);
    const picked = fallback[0];
    emitUiEvent('bestCrop', {
        source: 'fallback',
        strategy: farmRuntimeSettings.plantingStrategy,
        preferredSeedId: farmRuntimeSettings.preferredSeedId,
        level: state.level,
        landsCount: safeLandsCount,
        seedId: picked.seedId,
        seedName: getPlantNameBySeedId(picked.seedId),
        requiredLevel: picked.requiredLevel,
        price: picked.price,
        currentLevelBest: levelBestPair.currentLevelBest,
        nextLevelBest: levelBestPair.nextLevelBest,
    });
    return picked;
}

async function autoPlantEmptyLands(deadLandIds, emptyLandIds, unlockedLandCount) {
    let landsToPlant = [...emptyLandIds];
    const state = getUserState();

    // 1. 铲除枯死/收获残留植物（一键操作）
    if (deadLandIds.length > 0) {
        try {
            await removePlant(deadLandIds);
            log('铲除', `已铲除 ${deadLandIds.length} 块 (${deadLandIds.join(',')})`);
            landsToPlant.push(...deadLandIds);
        } catch (e) {
            logWarn('铲除', `批量铲除失败: ${e.message}`);
            // 失败时仍然尝试种植
            landsToPlant.push(...deadLandIds);
        }
    }

    if (landsToPlant.length === 0) return;

    // 2. 查询种子商店
    let bestSeed;
    try {
        bestSeed = await findBestSeed(unlockedLandCount);
    } catch (e) {
        logWarn('商店', `查询失败: ${e.message}`);
        return;
    }
    if (!bestSeed) return;

    const seedName = getPlantNameBySeedId(bestSeed.seedId);
    const growTime = getPlantGrowTime(1020000 + (bestSeed.seedId - 20000));  // 转换为植物ID
    const growTimeStr = growTime > 0 ? ` 生长${formatGrowTime(growTime)}` : '';
    log('商店', `最佳种子: ${seedName} (${bestSeed.seedId}) 价格=${bestSeed.price}金币${growTimeStr}`);

    // 3. 购买
    const needCount = landsToPlant.length;
    const totalCost = bestSeed.price * needCount;
    if (totalCost > state.gold) {
        logWarn('商店', `金币不足! 需要 ${totalCost} 金币, 当前 ${state.gold} 金币`);
        const canBuy = Math.floor(state.gold / bestSeed.price);
        if (canBuy <= 0) return;
        landsToPlant = landsToPlant.slice(0, canBuy);
        log('商店', `金币有限，只种 ${canBuy} 块地`);
    }

    let actualSeedId = bestSeed.seedId;
    try {
        const buyReply = await buyGoods(bestSeed.goodsId, landsToPlant.length, bestSeed.price);
        if (buyReply.get_items && buyReply.get_items.length > 0) {
            const gotItem = buyReply.get_items[0];
            const gotId = toNum(gotItem.id);
            const gotCount = toNum(gotItem.count);
            log('购买', `获得物品: ${getItemName(gotId)}(${gotId}) x${gotCount}`);
            if (gotId > 0) actualSeedId = gotId;
        }
        if (buyReply.cost_items) {
            for (const item of buyReply.cost_items) {
                state.gold -= toNum(item.count);
            }
        }
        const boughtName = getPlantNameBySeedId(actualSeedId);
        log('购买', `已购买 ${boughtName}种子 x${landsToPlant.length}, 花费 ${bestSeed.price * landsToPlant.length} 金币`);
    } catch (e) {
        logWarn('购买', e.message);
        return;
    }

    // 4. 种植（逐块拖动，间隔50ms）
    let plantedLands = [];
    try {
        const planted = await plantSeeds(actualSeedId, landsToPlant);
        log('种植', `已在 ${planted} 块地种植 (${landsToPlant.join(',')})`);
        if (planted > 0) {
            plantedLands = landsToPlant.slice(0, planted);
        }
    } catch (e) {
        logWarn('种植', e.message);
    }

    // 5. 施肥（逐块拖动，间隔50ms）
    if (plantedLands.length > 0 && farmRuntimeSettings.autoFertilize) {
        try {
            await ensureFertilizerStock(plantedLands.length);
        } catch (e) {
            logWarn('施肥', `补充肥料失败: ${e.message}`);
        }
        const fertilized = await fertilize(plantedLands);
        if (fertilized > 0) {
            log('施肥', `已为 ${fertilized}/${plantedLands.length} 块地施肥`);
        }
    }
}

// ============ 土地分析 ============

/**
 * 根据服务器时间确定当前实际生长阶段
 */
function getCurrentPhase(phases, debug, landLabel) {
    if (!phases || phases.length === 0) return null;

    const nowSec = getServerTimeSec();

    if (debug) {
        console.log(`    ${landLabel} 服务器时间=${nowSec} (${new Date(nowSec * 1000).toLocaleTimeString()})`);
        for (let i = 0; i < phases.length; i++) {
            const p = phases[i];
            const bt = toTimeSec(p.begin_time);
            const phaseName = PHASE_NAMES[p.phase] || `阶段${p.phase}`;
            const diff = bt > 0 ? (bt - nowSec) : 0;
            const diffStr = diff > 0 ? `(未来 ${diff}s)` : diff < 0 ? `(已过 ${-diff}s)` : '';
            console.log(`    ${landLabel}   [${i}] ${phaseName}(${p.phase}) begin=${bt} ${diffStr} dry=${toTimeSec(p.dry_time)} weed=${toTimeSec(p.weeds_time)} insect=${toTimeSec(p.insect_time)}`);
        }
    }

    for (let i = phases.length - 1; i >= 0; i--) {
        const beginTime = toTimeSec(phases[i].begin_time);
        if (beginTime > 0 && beginTime <= nowSec) {
            if (debug) {
                console.log(`    ${landLabel}   → 当前阶段: ${PHASE_NAMES[phases[i].phase] || phases[i].phase}`);
            }
            return phases[i];
        }
    }

    if (debug) {
        console.log(`    ${landLabel}   → 所有阶段都在未来，使用第一个: ${PHASE_NAMES[phases[0].phase] || phases[0].phase}`);
    }
    return phases[0];
}

function analyzeLands(lands) {
    const result = {
        harvestable: [], needWater: [], needWeed: [], needBug: [],
        growing: [], empty: [], dead: [],
        harvestableInfo: [],  // 收获植物的详细信息 { id, name, exp }
    };

    const nowSec = getServerTimeSec();
    const debug = false;

    if (debug) {
        console.log('');
        console.log('========== 首次巡田详细日志 ==========');
        console.log(`  服务器时间(秒): ${nowSec}  (${new Date(nowSec * 1000).toLocaleString()})`);
        console.log(`  总土地数: ${lands.length}`);
        console.log('');
    }

    for (const land of lands) {
        const id = toNum(land.id);
        if (!land.unlocked) {
            if (debug) console.log(`  土地#${id}: 未解锁`);
            continue;
        }

        const plant = land.plant;
        if (!plant || !plant.phases || plant.phases.length === 0) {
            result.empty.push(id);
            if (debug) console.log(`  土地#${id}: 空地`);
            continue;
        }

        const plantName = plant.name || '未知作物';
        const landLabel = `土地#${id}(${plantName})`;

        if (debug) {
            console.log(`  ${landLabel}: phases=${plant.phases.length} dry_num=${toNum(plant.dry_num)} weed_owners=${(plant.weed_owners||[]).length} insect_owners=${(plant.insect_owners||[]).length}`);
        }

        const currentPhase = getCurrentPhase(plant.phases, debug, landLabel);
        if (!currentPhase) {
            result.empty.push(id);
            continue;
        }
        const phaseVal = currentPhase.phase;

        if (phaseVal === PlantPhase.DEAD) {
            result.dead.push(id);
            if (debug) console.log(`    → 结果: 枯死`);
            continue;
        }

        if (phaseVal === PlantPhase.MATURE) {
            result.harvestable.push(id);
            // 收集植物信息用于日志
            const plantId = toNum(plant.id);
            const plantNameFromConfig = getPlantName(plantId);
            const plantExp = getPlantExp(plantId);
            result.harvestableInfo.push({
                landId: id,
                plantId,
                name: plantNameFromConfig || plantName,
                exp: plantExp,
            });
            if (debug) console.log(`    → 结果: 可收获 (${plantNameFromConfig} +${plantExp}经验)`);
            continue;
        }

        let landNeeds = [];
        const dryNum = toNum(plant.dry_num);
        const dryTime = toTimeSec(currentPhase.dry_time);
        if (dryNum > 0 || (dryTime > 0 && dryTime <= nowSec)) {
            result.needWater.push(id);
            landNeeds.push('缺水');
        }

        const weedsTime = toTimeSec(currentPhase.weeds_time);
        const hasWeeds = (plant.weed_owners && plant.weed_owners.length > 0) || (weedsTime > 0 && weedsTime <= nowSec);
        if (hasWeeds) {
            result.needWeed.push(id);
            landNeeds.push('有草');
        }

        const insectTime = toTimeSec(currentPhase.insect_time);
        const hasBugs = (plant.insect_owners && plant.insect_owners.length > 0) || (insectTime > 0 && insectTime <= nowSec);
        if (hasBugs) {
            result.needBug.push(id);
            landNeeds.push('有虫');
        }

        result.growing.push(id);
        if (debug) {
            const needStr = landNeeds.length > 0 ? ` 需要: ${landNeeds.join(',')}` : '';
            console.log(`    → 结果: 生长中(${PHASE_NAMES[phaseVal] || phaseVal})${needStr}`);
        }
    }

    if (debug) {
        console.log('');
        console.log('========== 巡田分析汇总 ==========');
        console.log(`  可收获: ${result.harvestable.length} [${result.harvestable.join(',')}]`);
        console.log(`  生长中: ${result.growing.length} [${result.growing.join(',')}]`);
        console.log(`  缺水:   ${result.needWater.length} [${result.needWater.join(',')}]`);
        console.log(`  有草:   ${result.needWeed.length} [${result.needWeed.join(',')}]`);
        console.log(`  有虫:   ${result.needBug.length} [${result.needBug.join(',')}]`);
        console.log(`  空地:   ${result.empty.length} [${result.empty.join(',')}]`);
        console.log(`  枯死:   ${result.dead.length} [${result.dead.join(',')}]`);
        console.log('====================================');
        console.log('');
    }

    return result;
}

function getNextPhase(phases, nowSec) {
    if (!Array.isArray(phases) || phases.length === 0) return null;
    let picked = null;
    for (const phase of phases) {
        const beginTime = toTimeSec(phase.begin_time);
        if (!beginTime || beginTime <= nowSec) continue;
        if (!picked || beginTime < toTimeSec(picked.begin_time)) {
            picked = phase;
        }
    }
    return picked;
}

function pickFirstPositiveNumber(values = []) {
    for (const value of values) {
        const n = Number(toNum(value));
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
}

function normalizeGoldRequirement(value, text = '', levelHint = 0) {
    const gold = Number(value);
    if (!Number.isFinite(gold) || gold <= 0) return 0;
    if (text.includes('万')) return gold * 10000;
    if (levelHint >= 10 && gold < 1000) {
        return gold * 10000;
    }
    return gold;
}

function parseLandRequirementCondition(condition = {}) {
    const cond = condition && typeof condition === 'object' ? condition : {};
    const directNeedLevel = pickFirstPositiveNumber([
        cond.need_level,
        cond.needLevel,
        cond.need_lv,
        cond.needLv,
    ]);
    let directNeedGold = pickFirstPositiveNumber([
        cond.need_gold,
        cond.needGold,
        cond.need_coin,
        cond.needCoin,
        cond.cost_gold,
        cond.costGold,
    ]);
    if (!directNeedGold) {
        const needGoldWan = pickFirstPositiveNumber([
            cond.need_gold_wan,
            cond.needGoldWan,
            cond.gold_wan,
            cond.goldWan,
        ]);
        if (needGoldWan > 0) {
            directNeedGold = needGoldWan * 10000;
        }
    }
    let condNeedLevel = 0;
    let condNeedGold = 0;
    let condNeedLevelByType = 0;
    let condNeedGoldByType = 0;

    const condItems = Array.isArray(cond.conds) ? cond.conds : [];
    for (const item of condItems) {
        const type = Number(toNum(item && (item.type ?? item.cond_type ?? item.id)));
        const value = pickFirstPositiveNumber([
            item && item.param,
            item && item.value,
            item && item.count,
            item && item.num,
            item && item.need_num,
            item && item.need_count,
        ]);
        const text = String(item && (item.name || item.desc || item.key || '')).toLowerCase();
        const looksLikeLevelText = text.includes('level') || text.includes('lv') || text.includes('等级') || text.includes('级');
        const looksLikeGoldText = text.includes('gold') || text.includes('coin') || text.includes('金币');

        if (!condNeedLevel && value > 0 && looksLikeLevelText) {
            condNeedLevel = value;
            continue;
        }
        if (!condNeedGold && value > 0 && looksLikeGoldText) {
            condNeedGold = value;
            continue;
        }
        if (!condNeedLevelByType && value > 0 && type === 1 && !looksLikeGoldText) {
            condNeedLevelByType = value;
            continue;
        }
        if (!condNeedGoldByType && value > 0 && type === 2 && !looksLikeLevelText) {
            condNeedGoldByType = value;
        }
    }

    let needLevel = condNeedLevel || directNeedLevel || condNeedLevelByType;
    let needGold = condNeedGold || directNeedGold || condNeedGoldByType;
    if (needGold > 0) {
        needGold = normalizeGoldRequirement(needGold, condNeedGold > 0 ? '金币' : '', needLevel);
    }

    const resourceItems = Array.isArray(cond.items)
        ? cond.items
        : (Array.isArray(cond.need_items) ? cond.need_items : []);
    for (const item of resourceItems) {
        if (needGold > 0) break;
        const itemId = Number(toNum(item && (item.id ?? item.item_id ?? item.itemId)));
        const count = pickFirstPositiveNumber([
            item && item.count,
            item && item.num,
            item && item.value,
            item && item.need_num,
        ]);
        if (itemId === 1 && count > 0) {
            needGold = normalizeGoldRequirement(count, '', needLevel);
        }
    }

    return { needLevel, needGold };
}

function resolveLandRequirementMeta(land, unlocked) {
    const landLevel = toNum(land && land.level);
    const maxLandLevel = toNum(land && land.max_level);
    const couldUnlock = Boolean(land && land.could_unlock);
    const couldUpgrade = Boolean(land && land.could_upgrade);

    if (!unlocked) {
        const parsed = parseLandRequirementCondition((land && land.unlock_condition) || {});
        return {
            type: 'unlock',
            label: '解锁需',
            needLevel: parsed.needLevel,
            needGold: parsed.needGold,
            couldUnlock,
            couldUpgrade: false,
            landLevel,
            maxLandLevel,
        };
    }

    const parsedUpgrade = parseLandRequirementCondition((land && land.upgrade_condition) || {});
    const hasUpgradeNeed = couldUpgrade
        || (maxLandLevel > 0 && landLevel < maxLandLevel)
        || parsedUpgrade.needLevel > 0
        || parsedUpgrade.needGold > 0;
    if (hasUpgradeNeed) {
        return {
            type: 'upgrade',
            label: '升级需',
            needLevel: parsedUpgrade.needLevel,
            needGold: parsedUpgrade.needGold,
            couldUnlock: false,
            couldUpgrade,
            landLevel,
            maxLandLevel,
        };
    }

    return {
        type: 'none',
        label: '无要求',
        needLevel: 0,
        needGold: 0,
        couldUnlock: false,
        couldUpgrade: false,
        landLevel,
        maxLandLevel,
    };
}

function buildLandUiItem(land, nowSec) {
    const id = toNum(land && land.id);
    const unlocked = Boolean(land && land.unlocked);
    const plant = (land && land.plant) || null;
    const requirement = resolveLandRequirementMeta(land, unlocked);
    if (!unlocked) {
        return {
            id,
            unlocked: false,
            isEmpty: true,
            phase: 0,
            phaseName: '未解锁',
            couldUnlock: requirement.couldUnlock,
            couldUpgrade: requirement.couldUpgrade,
            landLevel: requirement.landLevel,
            maxLandLevel: requirement.maxLandLevel,
            needLevel: requirement.needLevel,
            needGold: requirement.needGold,
            requirementType: requirement.type,
            requirementLabel: requirement.label,
            seedId: 0,
            plantId: 0,
            plantName: '',
            exp: 0,
            needs: {
                water: false,
                weed: false,
                bug: false,
            },
            nextPhaseName: '',
            nextPhaseInSec: 0,
        };
    }

    if (!plant || !Array.isArray(plant.phases) || plant.phases.length === 0) {
        return {
            id,
            unlocked: true,
            isEmpty: true,
            phase: 0,
            phaseName: '空地',
            couldUnlock: requirement.couldUnlock,
            couldUpgrade: requirement.couldUpgrade,
            landLevel: requirement.landLevel,
            maxLandLevel: requirement.maxLandLevel,
            needLevel: requirement.needLevel,
            needGold: requirement.needGold,
            requirementType: requirement.type,
            requirementLabel: requirement.label,
            seedId: 0,
            plantId: 0,
            plantName: '',
            exp: 0,
            needs: {
                water: false,
                weed: false,
                bug: false,
            },
            nextPhaseName: '',
            nextPhaseInSec: 0,
        };
    }

    const currentPhase = getCurrentPhase(plant.phases, false, `土地#${id}`) || {};
    const phase = toNum(currentPhase.phase);
    const phaseName = PHASE_NAMES[phase] || `阶段${phase}`;
    const nextPhase = getNextPhase(plant.phases, nowSec);
    const nextPhaseBegin = nextPhase ? toTimeSec(nextPhase.begin_time) : 0;
    const nextPhaseInSec = nextPhaseBegin > nowSec ? (nextPhaseBegin - nowSec) : 0;
    const nextPhaseName = nextPhase ? (PHASE_NAMES[nextPhase.phase] || `阶段${toNum(nextPhase.phase)}`) : '';
    const weedOwners = Array.isArray(plant.weed_owners) ? plant.weed_owners : [];
    const insectOwners = Array.isArray(plant.insect_owners) ? plant.insect_owners : [];
    const dryTime = toTimeSec(currentPhase.dry_time);
    const weedsTime = toTimeSec(currentPhase.weeds_time);
    const insectTime = toTimeSec(currentPhase.insect_time);
    const needsWater = toNum(plant.dry_num) > 0 || (dryTime > 0 && dryTime <= nowSec);
    const needsWeed = weedOwners.length > 0 || (weedsTime > 0 && weedsTime <= nowSec);
    const needsBug = insectOwners.length > 0 || (insectTime > 0 && insectTime <= nowSec);
    const plantId = toNum(plant.id);
    const plantName = getPlantName(plantId) || plant.name || '未知作物';
    const seedId = toNum(plant.seed_id);
    const exp = getPlantExp(plantId);

    return {
        id,
        unlocked: true,
        isEmpty: false,
        phase,
        phaseName,
        couldUnlock: requirement.couldUnlock,
        couldUpgrade: requirement.couldUpgrade,
        landLevel: requirement.landLevel,
        maxLandLevel: requirement.maxLandLevel,
        needLevel: requirement.needLevel,
        needGold: requirement.needGold,
        requirementType: requirement.type,
        requirementLabel: requirement.label,
        seedId,
        plantId,
        plantName,
        exp,
        stealable: Boolean(plant.stealable),
        needs: {
            water: needsWater,
            weed: needsWeed,
            bug: needsBug,
        },
        nextPhaseName,
        nextPhaseInSec,
    };
}

async function listLandsForUi() {
    const state = getUserState();
    if (!toNum(state.gid)) {
        throw new Error('not logged in');
    }

    const landsReply = await getAllLands();
    const lands = Array.isArray(landsReply.lands) ? landsReply.lands : [];
    const nowSec = getServerTimeSec();
    const summary = analyzeLands(lands);
    const actionTargets = pickLandActionTargets(lands);
    const items = lands
        .map((land) => buildLandUiItem(land, nowSec))
        .sort((a, b) => a.id - b.id);

    return {
        serverTimeSec: nowSec,
        summary: {
            total: lands.length,
            unlocked: lands.filter((land) => Boolean(land && land.unlocked)).length,
            lockable: actionTargets.unlockLandIds.length,
            upgradable: actionTargets.upgradeLandIds.length,
            harvestable: summary.harvestable.length,
            growing: summary.growing.length,
            empty: summary.empty.length,
            dead: summary.dead.length,
            needWater: summary.needWater.length,
            needWeed: summary.needWeed.length,
            needBug: summary.needBug.length,
        },
        lands: items,
    };
}

// ============ 巡田主循环 ============

async function checkFarm() {
    const state = getUserState();
    if (isCheckingFarm || !state.gid) return;
    isCheckingFarm = true;

    try {
        const landsReply = await getAllLands();
        if (!landsReply.lands || landsReply.lands.length === 0) {
            log('农场', '没有土地数据');
            return;
        }

        const lands = landsReply.lands;

        // 土地管理（解锁/升级）先于常规巡田执行
        await tryAutoUnlockAndUpgradeLands(lands);

        const status = analyzeLands(lands);
        const unlockedLandCount = lands.filter(land => land && land.unlocked).length;
        isFirstFarmCheck = false;

        // 构建状态摘要
        const statusParts = [];
        if (status.harvestable.length) statusParts.push(`收:${status.harvestable.length}`);
        if (status.needWeed.length) statusParts.push(`草:${status.needWeed.length}`);
        if (status.needBug.length) statusParts.push(`虫:${status.needBug.length}`);
        if (status.needWater.length) statusParts.push(`水:${status.needWater.length}`);
        if (status.dead.length) statusParts.push(`枯:${status.dead.length}`);
        if (status.empty.length) statusParts.push(`空:${status.empty.length}`);
        statusParts.push(`长:${status.growing.length}`);

        const hasWork = status.harvestable.length || status.needWeed.length || status.needBug.length
            || status.needWater.length || status.dead.length || status.empty.length;

        // 执行操作并收集结果
        const actions = [];

        // 一键操作：除草、除虫、浇水可以并行执行（游戏中都是一键完成）
        const batchOps = [];
        if (status.needWeed.length > 0) {
            batchOps.push(weedOut(status.needWeed).then(() => actions.push(`除草${status.needWeed.length}`)).catch(e => logWarn('除草', e.message)));
        }
        if (status.needBug.length > 0) {
            batchOps.push(insecticide(status.needBug).then(() => actions.push(`除虫${status.needBug.length}`)).catch(e => logWarn('除虫', e.message)));
        }
        if (status.needWater.length > 0) {
            batchOps.push(waterLand(status.needWater).then(() => actions.push(`浇水${status.needWater.length}`)).catch(e => logWarn('浇水', e.message)));
        }
        if (batchOps.length > 0) {
            await Promise.all(batchOps);
        }

        // 收获（一键操作）
        let harvestedLandIds = [];
        if (status.harvestable.length > 0) {
            try {
                await harvest(status.harvestable);
                actions.push(`收获${status.harvestable.length}`);
                harvestedLandIds = [...status.harvestable];
            } catch (e) { logWarn('收获', e.message); }
        }

        // 铲除 + 种植 + 施肥（需要顺序执行）
        const allDeadLands = [...status.dead, ...harvestedLandIds];
        const allEmptyLands = [...status.empty];
        if (allDeadLands.length > 0 || allEmptyLands.length > 0) {
            try {
                await autoPlantEmptyLands(allDeadLands, allEmptyLands, unlockedLandCount);
                actions.push(`种植${allDeadLands.length + allEmptyLands.length}`);
            } catch (e) { logWarn('种植', e.message); }
        }

        // 输出一行日志
        const actionStr = actions.length > 0 ? ` → ${actions.join('/')}` : '';
        if(hasWork) {
            log('农场', `[${statusParts.join(' ')}]${actionStr}${!hasWork ? ' 无需操作' : ''}`)
        }
    } catch (err) {
        logWarn('巡田', `检查失败: ${err.message}`);
    } finally {
        isCheckingFarm = false;
    }
}

/**
 * 农场巡查循环 - 本次完成后等待指定秒数再开始下次
 */
async function farmCheckLoop() {
    while (farmLoopRunning) {
        await checkFarm();
        if (!farmLoopRunning) break;
        await sleep(CONFIG.farmCheckInterval);
    }
}

function startFarmCheckLoop() {
    if (farmLoopRunning) return;
    farmLoopRunning = true;

    // 监听服务器推送的土地变化事件
    networkEvents.on('landsChanged', onLandsChangedPush);

    // 延迟 2 秒后启动循环
    farmCheckTimer = setTimeout(() => farmCheckLoop(), 2000);
}

/**
 * 处理服务器推送的土地变化
 */
let lastPushTime = 0;
function onLandsChangedPush(lands) {
    if (isCheckingFarm) return;
    const now = Date.now();
    if (now - lastPushTime < 500) return;  // 500ms 防抖
    
    lastPushTime = now;
    log('农场', `收到推送: ${lands.length}块土地变化，检查中...`);
    
    setTimeout(async () => {
        if (!isCheckingFarm) {
            await checkFarm();
        }
    }, 100);
}

function stopFarmCheckLoop() {
    farmLoopRunning = false;
    if (farmCheckTimer) { clearTimeout(farmCheckTimer); farmCheckTimer = null; }
    networkEvents.removeListener('landsChanged', onLandsChangedPush);
}

module.exports = {
    checkFarm, startFarmCheckLoop, stopFarmCheckLoop,
    getCurrentPhase,
    listLandsForUi,
    setOperationLimitsCallback,
    updateFarmRuntimeSettings,
    getFarmRuntimeSettings,
    __private: {
        pickLandActionTargets,
        parseLandRequirementCondition,
        resolveLandRequirementMeta,
        buildLandUiItem,
    },
};
