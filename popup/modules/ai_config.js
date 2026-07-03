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
        validateSecureApiBaseUrl(baseUrl);
    }
    return true;
}

// 外部 AI 地址强制 HTTPS；HTTP 仅允许本机回环（localhost/127.0.0.1/::1）用于本地调试，
// 避免 Token 与候选人数据明文经网络传输。
export function validateSecureApiBaseUrl(baseUrl) {
    const raw = normalizeManualApiBaseUrl(baseUrl);
    if (!raw) return true;

    let parsed;
    try {
        parsed = new URL(raw);
    } catch (error) {
        throw new Error("请填写有效的第三方 API URL，例如 https://api.example.com/v1/chat/completions");
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    const isLoopback =
        ["localhost", "127.0.0.1", "::1"].includes(hostname) ||
        hostname === "0.0.0.0" ||
        /^127\./.test(hostname);

    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:" && isLoopback) return true;

    throw new Error("AI API 地址必须使用 HTTPS；HTTP 仅允许 localhost / 127.0.0.1 本地调试");
}
