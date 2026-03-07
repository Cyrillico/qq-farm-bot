const { getAllPlants, getSeedPrice } = require('./gameConfig');

function getSeedOptions() {
    const allPlants = Array.isArray(getAllPlants()) ? getAllPlants() : [];
    const map = new Map();
    for (const plant of allPlants) {
        const seedId = Number(plant && plant.seed_id) || 0;
        if (seedId <= 0) continue;
        if (map.has(seedId)) continue;
        const name = String(plant && plant.name || '').trim() || `种子#${seedId}`;
        const level = Number.isFinite(Number(plant && plant.land_level_need))
            ? Math.max(0, Number(plant.land_level_need) || 0)
            : 0;
        const price = getSeedPrice(seedId);
        map.set(seedId, {
            seedId,
            plantId: Number(plant && plant.id) || 0,
            name,
            level,
            price,
            label: `${name}种子 (${seedId}) · Lv${level} · ${price}金币`,
        });
    }
    return [...map.values()].sort((a, b) => a.level - b.level || a.seedId - b.seedId);
}

module.exports = {
    getSeedOptions,
};
