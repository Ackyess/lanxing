export function clampBatchLimit(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return 1;
    return Math.max(1, Math.min(200, Math.floor(numberValue)));
}

export function buildBatchPlan({ batchConfig, positions }) {
    if (!batchConfig?.enabled) return null;
    if (!Array.isArray(batchConfig.items) || batchConfig.items.length === 0) return null;

    const positionsById = new Map((positions || []).map((position) => [String(position.id), position]));
    const plan = [];

    for (const item of batchConfig.items) {
        const id = String(item?.positionId || "");
        if (!id) continue;

        const position = positionsById.get(id);
        if (!position) continue;

        plan.push({
            positionId: position.id,
            positionName: position.name,
            jobDescription: position.description,
            matchLimit: clampBatchLimit(item?.limit ?? 200),
        });
    }

    return plan.length ? plan : null;
}
