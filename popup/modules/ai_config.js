export const DEFAULT_MANUAL_AI_MODEL = "gpt-5.5";

export function normalizeManualToken(value) {
    return String(value || "").trim();
}

export function normalizeManualApiBaseUrl(value) {
    return String(value || "").trim();
}

export function resolveSelectedModel({
    selectedValue,
    customValue,
    fallbackModel = DEFAULT_MANUAL_AI_MODEL
} = {}) {
    const selected = String(selectedValue || "").trim();
    if (selected === "custom") {
        return String(customValue || "").trim();
    }
    return selected || String(fallbackModel || DEFAULT_MANUAL_AI_MODEL).trim();
}

export function buildManualAIConfig({
    token,
    selectedModel,
    customModel,
    baseUrl,
    platform = "custom",
    fallbackModel = DEFAULT_MANUAL_AI_MODEL
} = {}) {
    return {
        platform: String(platform || "custom").trim(),
        token: normalizeManualToken(token),
        baseUrl: normalizeManualApiBaseUrl(baseUrl),
        model: resolveSelectedModel({
            selectedValue: selectedModel,
            customValue: customModel,
            fallbackModel
        })
    };
}

export function validateManualAIConfig(config) {
    if (!normalizeManualToken(config?.token)) {
        throw new Error("请填写 AI API Token");
    }
    if (!String(config?.model || "").trim()) {
        throw new Error("请选择或填写模型名称");
    }
    const baseUrl = normalizeManualApiBaseUrl(config?.baseUrl);
    if (baseUrl) {
        try {
            const parsed = new URL(baseUrl);
            if (!["http:", "https:"].includes(parsed.protocol)) {
                throw new Error("invalid_protocol");
            }
        } catch (error) {
            throw new Error("请填写有效的第三方 API URL，例如 https://api.example.com/v1/chat/completions");
        }
    }
    return true;
}
