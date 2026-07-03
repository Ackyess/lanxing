function cleanText(value) {
    return String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
}

function limitText(value, maxLength = Infinity) {
    const text = cleanText(value);
    if (!Number.isFinite(maxLength) || text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}\n...[已截断]`;
}

function snapshotLine(label, value) {
    const text = cleanText(value);
    return text ? `${label}: ${text}` : `${label}: 未提供`;
}

function extractCandidateNameFromItem(item) {
    return cleanText(item?.candidateName || item?.snapshot?.candidateName || "");
}

function isResumeOcrNoiseLine(line) {
    const text = cleanText(line);
    if (!text) return false;
    if (/^(推荐牛人|推荐|精选|最新|打招呼)$/.test(text)) return true;
    if (/^A$/i.test(text)) return true;
    if (/^AI[:：](通过|淘汰)/.test(text)) return true;
    if (/^(运行日志|今日打招呼|流程[:：]?)$/.test(text)) return true;
    return false;
}

function sanitizeResumeOcrText(text, item = {}) {
    const rawLines = String(text || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/g, ""));

    const candidateName = extractCandidateNameFromItem(item);
    let lines = rawLines;
    if (candidateName) {
        const candidateStart = lines.findIndex((line) => line.includes(candidateName));
        if (candidateStart > 0 && candidateStart <= 8) {
            lines = lines.slice(candidateStart);
        }
    }

    return lines
        .filter((line) => !isResumeOcrNoiseLine(line))
        .join("\n")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();
}

function getPositionContextKey(item) {
    return cleanText(item?.positionId || item?.positionName || "unknown_position");
}

export function buildCandidatePromptText(item, options = {}) {
    const snapshot = item?.snapshot || {};
    const resumeText = limitText(
        sanitizeResumeOcrText(item?.resumeText || item?.ocrText || item?.resumeFullText || "", item),
        options.resumeTextLimit
    );
    const detailText = limitText(item?.detailText || "", options.detailTextLimit);
    const simpleText = limitText(item?.simpleText || "", options.simpleTextLimit);
    const positionContextKey = getPositionContextKey(item);

    return [
        `【候选人】${cleanText(item?.candidateName) || "未知候选人"}`,
        `【候选人ID】${cleanText(item?.id) || cleanText(item?.candidateId) || "未提供"}`,
        `【岗位】${cleanText(item?.positionName) || "未归类岗位"}`,
        `【岗位要求引用】${positionContextKey}`,
        `【AI初筛原因】${cleanText(item?.aiReason) || "未提供"}`,
        "【结构化字段】",
        snapshotLine("工作年限", snapshot.workYears),
        snapshotLine("学历", snapshot.education),
        snapshotLine("学校", snapshot.university),
        snapshotLine("专业", snapshot.major),
        snapshotLine("期望职位", snapshot.expectedPosition),
        snapshotLine("期望地点", snapshot.expectedLocation),
        snapshotLine("期望薪资", snapshot.salary),
        snapshotLine("在线状态", snapshot.activeText),
        `【候选人基础摘要】\n${simpleText || "未提供"}`,
        `【详情页结构化文本】\n${detailText || "未提供"}`,
        `【在线简历/OCR全文】\n${resumeText || "未提取到 OCR 全文；请谨慎使用，仅参考上面的结构化信息。"}`
    ].join("\n");
}

export function buildPositionContexts(pool) {
    const contexts = new Map();
    for (const item of pool) {
        const positionContextKey = getPositionContextKey(item);
        if (contexts.has(positionContextKey)) continue;
        contexts.set(positionContextKey, {
            positionContextKey,
            positionId: cleanText(item?.positionId || ""),
            positionName: cleanText(item?.positionName || ""),
            jobDescription: cleanText(item?.jobDescription || "")
        });
    }
    return Array.from(contexts.values());
}

export function buildExportRows(pool) {
    return pool.map((item, index) => {
        const resumeText = sanitizeResumeOcrText(item?.resumeText || item?.ocrText || item?.resumeFullText || "", item);
        const detailText = cleanText(item?.detailText || item?.simpleText || "");
        const simpleText = cleanText(item?.simpleText || "");
        const positionContextKey = getPositionContextKey(item);

        const modelPromptText = buildCandidatePromptText({
            ...item,
            resumeText,
            detailText,
            simpleText
        });

        return {
            rank: item?.ranking?.rank || index + 1,
            score: item?.ranking?.score || "",
            candidateName: item?.candidateName || "",
            positionContextKey,
            positionId: item?.positionId || "",
            positionName: item?.positionName || "",
            aiReason: item?.aiReason || "",
            workYears: item?.snapshot?.workYears || "",
            education: item?.snapshot?.education || "",
            university: item?.snapshot?.university || "",
            expectedPosition: item?.snapshot?.expectedPosition || "",
            expectedLocation: item?.snapshot?.expectedLocation || "",
            salary: item?.snapshot?.salary || "",
            activeText: item?.snapshot?.activeText || "",
            approvedAt: item?.approvedAt || "",
            firstApprovedAt: item?.firstApprovedAt || "",
            hasResumeText: resumeText.length > 0,
            resumeTextLength: resumeText.length,
            detailTextLength: detailText.length,
            modelPromptTextLength: modelPromptText.length,
            resumeText,
            detailText,
            simpleText,
            modelPromptText
        };
    });
}

export function buildExportPayload(pool, options = {}) {
    return {
        schemaVersion: 2,
        exportedAt: options.exportedAt || new Date().toISOString(),
        positionContexts: buildPositionContexts(pool),
        candidates: buildExportRows(pool)
    };
}
