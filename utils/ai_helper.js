// AI请求处理工具
// 此文件被 content script 和 popup 共同引用

const HR_AI_UTILS = {
    extractCandidateNameFromText(text) {
        const value = String(text || "");
        const match = value.match(/姓名[:：]\s*([^\s\n|，,]+)/);
        return match?.[1]?.trim() || "";
    },

    isResumeOcrNoiseLine(line) {
        const text = String(line || "").trim();
        if (!text) return false;
        if (/^(推荐牛人|推荐|精选|最新|打招呼)$/.test(text)) return true;
        if (/^A$/i.test(text)) return true;
        if (/^AI[:：](通过|淘汰)/.test(text)) return true;
        if (/^(运行日志|今日打招呼|流程[:：]?)$/.test(text)) return true;
        return false;
    },

    sanitizeResumeOcrText(text, candidateContext = "") {
        const rawLines = String(text || "")
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .split("\n")
            .map((line) => line.replace(/[ \t]+$/g, ""));

        const candidateName = this.extractCandidateNameFromText(candidateContext);
        let lines = rawLines;

        if (candidateName) {
            const candidateStart = lines.findIndex((line) => line.includes(candidateName));
            if (candidateStart > 0 && candidateStart <= 8) {
                lines = lines.slice(candidateStart);
            }
        }

        const cleanedLines = lines.filter((line) => !this.isResumeOcrNoiseLine(line));
        return cleanedLines
            .join("\n")
            .replace(/\n{4,}/g, "\n\n\n")
            .trim();
    },

    normalizeChatCompletionsUrl(baseUrl) {
        const raw = String(baseUrl || '').trim();
        if (!raw) return '';
        const withoutTrailingSlash = raw.replace(/\/+$/, '');
        if (/\/chat\/completions$/.test(withoutTrailingSlash)) return withoutTrailingSlash;
        if (/\/v1$/.test(withoutTrailingSlash)) return `${withoutTrailingSlash}/chat/completions`;
        return `${withoutTrailingSlash}/v1/chat/completions`;
    },

    getDefaultApiConfig() {
        const config = globalThis.LANXING_CONFIG;
        return {
            baseUrl: this.normalizeChatCompletionsUrl(config?.DEFAULT_API?.baseUrl),
            maxTokens: config?.DEFAULT_API?.maxTokens || 1024,
            temperature: config?.DEFAULT_API?.temperature ?? 0.1
        };
    },

    buildApiConfig(apiOverrides = {}, aiConfig = {}) {
        const defaultApiConfig = this.getDefaultApiConfig();
        const overrideBaseUrl = String(apiOverrides?.baseUrl || "").trim();
        const configuredBaseUrl = String(aiConfig?.baseUrl || "").trim();
        const baseUrl = overrideBaseUrl || configuredBaseUrl || defaultApiConfig.baseUrl;

        return {
            ...defaultApiConfig,
            ...(apiOverrides || {}),
            baseUrl: this.normalizeChatCompletionsUrl(baseUrl)
        };
    },

    shouldProxyThroughBackground() {
        return (
            typeof window !== 'undefined' &&
            typeof chrome !== 'undefined' &&
            chrome.runtime?.id &&
            window.location?.protocol !== 'chrome-extension:'
        );
    },

    sendRequestViaBackground(apiConfig, aiConfig, messages) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                type: 'LANXING_AI_REQUEST',
                data: { apiConfig, aiConfig, messages }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }
                resolve(response || { success: false, error: 'AI_BACKGROUND_EMPTY_RESPONSE' });
            });
        });
    },

    // 构建系统提示词
    buildSystemPrompt(template, positionName, jobDescription, candidateInfo) {
        if (!template) return "提示词模板为空";
        return template
            .replace('${岗位名称}', positionName || '未设置岗位名称')
            .replace('${岗位信息}', jobDescription || '未设置岗位要求')
            .replace('${候选人信息}', candidateInfo || '未提供候选人信息');
    },

    // 构造请求消息体
    buildMessages(systemContent, userContent, imageBase64 = null) {
        const messages = [
            {
                role: 'system',
                content: systemContent
            }
        ];

        const userMessageContent = [
            { type: "text", text: userContent }
        ];

        if (imageBase64) {
            userMessageContent.push({
                type: "image_url",
                image_url: {
                    url: `data:image/jpeg;base64,${imageBase64}`
                }
            });
        }

        messages.push({
            role: 'user',
            content: userMessageContent
        });

        return messages;
    },

    // 发送AI请求（通用）
    async sendRequest(apiConfig, aiConfig, messages) {
        try {
            if (this.shouldProxyThroughBackground()) {
                return await this.sendRequestViaBackground(apiConfig, aiConfig, messages);
            }

            const controller = new AbortController();
            const timeoutMs = Math.max(1000, Number(apiConfig.timeoutMs || 30000));
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            let response;
            try {
                response = await fetch(this.normalizeChatCompletionsUrl(apiConfig.baseUrl), {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${aiConfig.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: aiConfig.model,
                        messages: messages,
                        max_tokens: apiConfig.maxTokens,
                        temperature: apiConfig.temperature
                    }),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeoutId);
            }

            if (!response.ok) {
                throw new Error(`API请求失败，HTTP状态码: ${response.status}`);
            }

            const data = await response.json();
            const aiResponse = data.choices?.[0]?.message?.content;

            if (!aiResponse) {
                throw new Error('AI响应为空');
            }

            return {
                success: true,
                response: aiResponse.trim()
            };
        } catch (error) {
            const msg = error.name === 'AbortError'
                ? `AI请求超时（${Math.round(Number(apiConfig.timeoutMs || 30000) / 1000)}秒无响应），请检查网络或API服务状态`
                : error.message;
            return {
                success: false,
                error: msg
            };
        }
    },

    async extractResumeText(imageData, candidateText, aiConfig) {
        if (!aiConfig || !aiConfig.token) {
            return { success: false, error: "AI配置无效或缺失Token", text: "" };
        }

        const systemPrompt = [
            "你是一个 OCR 逐字转写助手。",
            "只读取图片中实际可见的文字，按截图中的视觉顺序完整转写。",
            "必须逐字保留原文内容，一字不改；不要总结、不要概括、不要润色、不要改写、不要补全。",
            "尽量保留原文的换行、段落、列表符号、标点、数字、大小写和空格层级。",
            "看不清的文字用 [无法辨认] 标记，不要猜测或编造。",
            "输出必须是 JSON：{\"resume_text\":\"...\"}"
        ].join("\n");

        const userPrompt = [
            "请逐字转写截图中的全部可见文字，只把截图里能看到的文字放入 resume_text。",
            candidateText ? `以下候选人基础信息仅用于定位候选人，不得合并进 resume_text，除非同样出现在截图中：\n${candidateText}` : ""
        ].filter(Boolean).join("\n\n");

        let base64Image = imageData;
        if (imageData.includes(',')) {
            base64Image = imageData.split(',')[1];
        }

        const messages = this.buildMessages(systemPrompt, userPrompt, base64Image);
        const defaultApiConfig = this.getDefaultApiConfig();
        const apiConfig = this.buildApiConfig({
            timeoutMs: Math.max(Number(defaultApiConfig.timeoutMs || 0), 120000)
        }, aiConfig);
        const result = await this.sendRequest(apiConfig, aiConfig, messages);

        if (!result.success) {
            return { success: false, error: result.error, text: "" };
        }

        const content = String(result.response || "");
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                const text = this.sanitizeResumeOcrText(
                    parsed.resume_text || parsed.text || parsed.content || "",
                    candidateText
                );
                const summary = String(parsed.summary || "").trim();
                return { success: true, text, summary, raw: content };
            } catch (e) {
                return { success: true, text: this.sanitizeResumeOcrText(content, candidateText), summary: "", raw: content };
            }
        }

        return { success: true, text: this.sanitizeResumeOcrText(content, candidateText), summary: "", raw: content };
    },

    normalizeDecisionFlag(value) {
        if (value === true) return true;
        if (value === false) return false;

        const normalized = String(value || "").trim().toLowerCase();
        if (["是", "通过", "yes", "true", "pass", "recommend"].includes(normalized)) return true;
        if (["否", "不通过", "淘汰", "no", "false", "fail", "reject"].includes(normalized)) return false;
        return false;
    },

    extractDecisionScore(parsed) {
        const candidates = [
            parsed?.score,
            parsed?.matchScore,
            parsed?.match_score,
            parsed?.rating
        ];

        for (const value of candidates) {
            if (value === null || value === undefined || value === "") continue;
            const match = String(value).match(/-?\d+(?:\.\d+)?/);
            if (!match) continue;

            const score = Number(match[0]);
            if (!Number.isFinite(score)) continue;
            if (score >= 0 && score <= 1) return Math.round(score * 100);
            if (score >= 0 && score <= 100) return Math.round(score);
        }

        return null;
    },

    hasWeakPassSignal(text) {
        return /可培养|有基础|相关基础|意向符合|学历.*匹配|英语.*匹配|地点.*匹配|薪资.*匹配|有相关实习|运营实习|经验待核|待核|再看看|基本符合|尚可|备选|弱匹配|一般|不确定|证据不足/.test(String(text || ""));
    },

    hasStrongPassSignal(text) {
        return /强匹配|强推荐|优先沟通|立即沟通|马上沟通|可优先|高度匹配|核心经验.*匹配|直接匹配/.test(String(text || ""));
    },

    hasExceptionalPassSignal(text) {
        return /极其亮眼|非常亮眼|特别亮眼|破格通过|破例通过|明显超出|远超同龄|远超同资历|突出成果|从0到1|扭亏为盈|爆款|TOP|头部|ACOS.*降|ROI.*提升|转化率.*提升|销售额.*增长|GMV.*增长|排名.*提升/.test(String(text || ""));
    },

    hasAmazonAiProjectSignal(text) {
        const value = String(text || "");
        const hasAmazon = /亚马逊|Amazon/i.test(value);
        const hasAi = /\bAI\b|人工智能|智能体|大模型|自动化|机器学习|ChatGPT|AIGC/i.test(value);
        const hasProject = /项目|选品|广告|CPC|Listing|卖点|评论分析|竞品分析|销量预测|数据分析|运营自动化|报表|关键词|转化率|ACOS|ROI/i.test(value);
        return hasAmazon && hasAi && hasProject;
    },

    normalizeScreeningDecision(parsed) {
        const wantsPass = this.normalizeDecisionFlag(parsed?.decision);
        const reason = String(parsed?.reason || parsed?.summary || "无原因").replace(/\s+/g, " ").trim();
        const score = this.extractDecisionScore(parsed);
        const fitLevel = String(parsed?.fitLevel || parsed?.level || parsed?.recommendation || "").trim();
        const evidence = Array.isArray(parsed?.evidence) ? parsed.evidence : [];
        const risks = Array.isArray(parsed?.risks) ? parsed.risks : (Array.isArray(parsed?.concerns) ? parsed.concerns : []);
        const exceptionReason = String(parsed?.exceptionReason || parsed?.exception_reason || "").trim();
        const combined = [
            reason,
            fitLevel,
            evidence.join(" "),
            risks.join(" "),
            exceptionReason
        ].join(" ");
        const evidenceCount = evidence.map((item) => String(item || "").trim()).filter(Boolean).length;
        const hasExceptionalPass = this.hasExceptionalPassSignal(combined) && evidenceCount >= 1;
        const hasAmazonAiProject = this.hasAmazonAiProjectSignal(combined) && evidenceCount >= 1;

        if (!wantsPass) {
            return { decision: "否", reason: reason || "不符合严格筛选口径" };
        }

        if (score !== null && score < 84) {
            if (score >= 79 && hasExceptionalPass) {
                return {
                    decision: "是",
                    reason: `破格通过(${score}/100)：${reason || exceptionReason || "存在极其亮眼的可验证证据"}`
                };
            }

            if (score >= 79 && hasAmazonAiProject && !/证据不足|待核|不确定|无亚马逊实操|核心岗位经验不明确|明显不匹配/.test(combined)) {
                return {
                    decision: "是",
                    reason: `AI项目加分(${score}/100)：${reason || exceptionReason || "亚马逊AI相关项目与岗位相关"}`
                };
            }

            return {
                decision: "否",
                reason: `未达通过线(${score}/100)：${reason || "匹配度不足"}`
            };
        }

        if (score === null && !this.hasStrongPassSignal(combined)) {
            return {
                decision: "否",
                reason: `缺少评分，按保守策略不通过：${reason || "证据不足"}`
            };
        }

        if ((score === null || score < 84) && this.hasWeakPassSignal(combined) && !this.hasStrongPassSignal(combined)) {
            return {
                decision: "否",
                reason: `弱通过信号，按保守策略不通过：${reason || "证据不足"}`
            };
        }

        return { decision: "是", reason: reason || "强匹配，可优先沟通" };
    },

    // 6. 分析候选人简历（整合流程 - 通用）
    async analyzeCandidateResume(imageData, candidateText, positionName, jobDescription, aiConfig, userPromptTemplate) {
        if (!aiConfig || !aiConfig.token) {
            return { decision: "否", reason: "AI配置无效或缺失Token" };
        }

        // 1. 获取 System Prompt 模板
        const systemPromptTemplate = (typeof window !== 'undefined' && window.HR_SYSTEM_PROMPTS?.SYSTEM_PROMPT) 
            ? window.HR_SYSTEM_PROMPTS.SYSTEM_PROMPT 
            : "你是一个专业的HR助手。";

        // 2. 构建 System Prompt
        const systemPrompt = this.buildSystemPrompt(
            systemPromptTemplate,
            positionName,
            jobDescription,
            candidateText
        );

        // 3. 构建 User Prompt
        const userPrompt = userPromptTemplate || (
            (typeof window !== 'undefined' && window.HR_SYSTEM_PROMPTS?.USER_PROMPT)
                ? window.HR_SYSTEM_PROMPTS.USER_PROMPT
                : "请根据上述信息进行判断。"
        );

        // 4. 构建消息 (Image base64 处理)
        // 确保 imageData 是纯 base64 字符串
        let base64Image = imageData;
        if (imageData.includes(',')) {
            base64Image = imageData.split(',')[1];
        }
        
        const messages = this.buildMessages(systemPrompt, userPrompt, base64Image);

        // 5. 发送请求
        const apiConfig = this.buildApiConfig({}, aiConfig);

        const result = await this.sendRequest(apiConfig, aiConfig, messages);

        // 6. 解析结果
        if (result.success) {
            let content = result.response;
            // console.log("[AI_UTILS] AI原始响应:", content);
            
            // 尝试提取 JSON
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return this.normalizeScreeningDecision(parsed);
                } catch (e) {
                    console.error("JSON解析失败", e);
                }
            }
            
            const fallbackReason = String(content || "").substring(0, 80).replace(/\s+/g, " ").trim();
            return {
                decision: "否",
                reason: fallbackReason
                    ? `非结构化响应，按保守策略不通过：${fallbackReason}`
                    : "AI未返回结构化JSON，按保守策略不通过"
            };
        } else {
            return { decision: "否", reason: `请求失败: ${result.error}` };
        }
    }
};

// 挂载到全局对象，兼容不同环境
if (typeof window !== 'undefined') {
    window.HR_AI_UTILS = HR_AI_UTILS;
} else if (typeof self !== 'undefined') {
    self.HR_AI_UTILS = HR_AI_UTILS;
}

// 尝试导出 (兼容 module 环境)
try {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = HR_AI_UTILS;
    }
} catch (e) {}

