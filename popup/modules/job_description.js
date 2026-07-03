export function normalizeJobDescriptionText(text) {
    return String(text || "")
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<\/?p[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function normalizeHeading(text) {
    return String(text || "")
        .replace(/[\s　]+/g, "")
        .replace(/[：:]/g, "")
        .toLowerCase();
}

export function extractJobResponsibilitiesAndRequirements(text) {
    const lines = String(text || "").split("\n").map((line) => line.trimEnd());
    const wanted = new Set(["岗位职责", "任职要求"].map(normalizeHeading));
    const headingCandidates = [
        "岗位职责",
        "任职要求",
        "任职资格",
        "岗位要求",
        "工作职责",
        "加分项",
        "福利待遇",
        "职位描述",
        "岗位描述",
    ].map(normalizeHeading);

    const getHeading = (line) => {
        const key = normalizeHeading(line);
        if (!key) return null;
        for (const candidate of headingCandidates) {
            if (key === candidate) return candidate;
            if (key.startsWith(candidate) && key.length <= candidate.length + 4) return candidate;
        }
        return null;
    };

    const blocks = new Map();
    let currentHeading = null;
    let currentLines = [];

    const flush = () => {
        if (!currentHeading) return;
        if (!wanted.has(currentHeading)) return;
        if (blocks.has(currentHeading)) return;
        blocks.set(currentHeading, currentLines.join("\n").trim());
    };

    for (const rawLine of lines) {
        const heading = getHeading(rawLine.trim());
        if (heading) {
            flush();
            currentHeading = heading;
            currentLines = [];
            continue;
        }
        if (currentHeading) currentLines.push(rawLine);
    }
    flush();

    const responsibilities = blocks.get(normalizeHeading("岗位职责")) || "";
    const requirements = blocks.get(normalizeHeading("任职要求")) || "";
    const parts = [];

    if (responsibilities) parts.push(`岗位职责：\n${responsibilities}`.trim());
    if (requirements) parts.push(`任职要求：\n${requirements}`.trim());
    return parts.join("\n\n").trim();
}

export function buildPositionDescriptionFromBossJob(job, previewZpData) {
    const raw = (previewZpData?.postDescription || previewZpData?.postDesc || "").trim();
    if (!raw) return "";

    const normalizedText = normalizeJobDescriptionText(raw);
    return extractJobResponsibilitiesAndRequirements(normalizedText) || normalizedText;
}

export function buildBossPositionTitle(job) {
    const title = String(job?.positionName || job?.jobName || "").trim();
    if (!title) return "未命名职位";

    const address = String(job?.addressShowText || job?.locationName || "").trim();
    const salary = String(job?.salaryDesc || "").trim();

    if (address && salary) return `${title} _ ${address} ${salary}`;
    if (address) return `${title} _ ${address}`;
    if (salary) return `${title} _ ${salary}`;
    return title;
}
