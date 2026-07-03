(function attachCandidateHelpers(root) {
    "use strict";

    function normalizeStoredText(value, maxLength = 2000) {
        const text = String(value || "").replace(/\s+/g, " ").trim();
        if (!text) return "";
        if (text.length <= maxLength) return text;
        return `${text.slice(0, maxLength)}...`;
    }

    function normalizeLongStoredText(value, maxLength = 30000) {
        const text = String(value || "")
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{4,}/g, "\n\n\n")
            .trim();
        if (!text) return "";
        if (text.length <= maxLength) return text;
        return `${text.slice(0, maxLength)}\n...[已截断]`;
    }

    function getCandidateStableId(candidate) {
        return String(
            candidate?.geekCard?.encryptId ||
            candidate?.geekCard?.encryptGeekId ||
            candidate?.encryptId ||
            candidate?.id ||
            candidate?.name ||
            ""
        ).trim();
    }

    function getCandidateDisplayName(candidate) {
        return String(
            candidate?.name ||
            candidate?.candidateName ||
            candidate?.geekCard?.geekName ||
            candidate?.geekName ||
            ""
        ).trim();
    }

    function buildDecisionCandidateText({ simpleText, detailText, resumeText, ocrError } = {}) {
        const parts = [];
        const simple = String(simpleText || "").trim();
        const detail = String(detailText || "").trim();
        const resume = String(resumeText || "").trim();
        const error = String(ocrError || "").trim();

        if (simple) {
            parts.push(`【候选人基础信息】\n${simple}`);
        }
        if (detail) {
            parts.push(`【候选人结构化信息】\n${detail}`);
        }
        if (resume) {
            parts.push(`【OCR简历全文】\n${resume}`);
        } else if (error) {
            parts.push(`【OCR状态】未提取到可用全文：${error}`);
        } else {
            parts.push("【OCR状态】未提取到可用全文");
        }

        return parts.join("\n\n").trim() || "未提供候选人信息";
    }

    function getCandidateIdentityFromAction(data = {}) {
        const candidate = data?.candidate || {};
        return {
            candidateId: String(data?.candidateId || getCandidateStableId(candidate) || "").trim(),
            candidateName: String(data?.candidateName || getCandidateDisplayName(candidate) || "").trim()
        };
    }

    function buildApprovedCandidateSnapshot(candidate) {
        const geekCard = candidate?.geekCard || {};
        return {
            candidateId: getCandidateStableId(candidate),
            candidateName: candidate?.name || geekCard?.geekName || "",
            age: candidate?.age || geekCard?.ageDesc || "",
            education: candidate?.education || geekCard?.geekDegree || "",
            university: candidate?.university || geekCard?.geekEdu?.school || "",
            major: geekCard?.geekEdu?.major || "",
            workYears: geekCard?.geekWorkYear || candidate?.experience || "",
            salary: geekCard?.salary || candidate?.salary || "",
            expectedPosition: geekCard?.expectPositionName || "",
            expectedLocation: geekCard?.expectLocationName || candidate?.location || "",
            activeText: candidate?.activeText || geekCard?.applyStatusDesc || "",
            selfIntro: normalizeStoredText(geekCard?.geekDesc?.content || candidate?.description || "", 800),
            extraInfo: Array.isArray(candidate?.extraInfo)
                ? candidate.extraInfo
                    .map((item) => ({
                        type: String(item?.type || "").trim(),
                        value: normalizeStoredText(item?.value || "", 200)
                    }))
                    .filter((item) => item.type || item.value)
                : []
        };
    }

    function buildApprovedCandidateRecordId(positionId, positionName, candidate) {
        const candidateId = getCandidateStableId(candidate) || normalizeStoredText(candidate?.name || "unknown_candidate", 80);
        const positionKey = String(positionId || positionName || "unknown_position").trim() || "unknown_position";
        return `${positionKey}::${candidateId}`;
    }

    root.LanxingCandidateHelpers = {
        normalizeStoredText,
        normalizeLongStoredText,
        getCandidateStableId,
        getCandidateDisplayName,
        buildDecisionCandidateText,
        getCandidateIdentityFromAction,
        buildApprovedCandidateSnapshot,
        buildApprovedCandidateRecordId
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
