import { buildCandidatePromptText } from "./talent_pool_export.js";

export function buildRankingPrompt(positionName, jobDescription, candidates) {
    const candidateBlock = candidates.map((item, index) => {
        return [
            `候选人#${index + 1}`,
            buildCandidatePromptText(
                {
                    ...item,
                    positionName: item?.positionName || positionName,
                    jobDescription: item?.jobDescription || jobDescription
                },
                {
                    simpleTextLimit: 1200,
                    detailTextLimit: 6000,
                    resumeTextLimit: 12000
                }
            )
        ].join("\n");
    }).join("\n\n---\n\n");

    return [
        "你是资深招聘负责人，正在做候选人横评。请慢下来做充分比较，不要用表面关键词快速排序。",
        "",
        `岗位名称：${positionName || "未提供"}`,
        `岗位要求：${jobDescription || "未提供"}`,
        "",
        "重要原则：",
        "1. 岗位介绍只是输入之一，不能作为唯一准则。",
        "2. 必须同时评估候选人的真实履历证据、工作轨迹、岗位相关经验、平台/品类匹配度、数据与广告能力、英语/学习能力、稳定性、薪资与到岗风险、成长潜力。",
        "3. 不要只看 AI 初筛原因；它只是参考，不能替代你的独立判断。",
        "4. 对每位候选人都要找支持证据和扣分风险；证据不足时要明确写“证据不足”。",
        "5. 排名必须体现相对比较：为什么第 1 名比第 2 名更适合，为什么后面的候选人不优先。",
        "",
        "评分维度建议：",
        "- 核心岗位经验 30%：是否真正做过类似岗位、平台、站点、广告、Listing、FBA、库存等。",
        "- 成果与数据能力 20%：是否有可验证的业绩、数据分析、广告优化、增长结果。",
        "- 学习与迁移能力 15%：专业背景、英语、工具能力、AI/数据意识、跨岗位迁移可能性。",
        "- 稳定性与现实约束 15%：到岗状态、薪资匹配、工作年限、职业路径连贯性。",
        "- 沟通与协作 10%：简历中体现的协作、表达、责任心、抗压能力。",
        "- 风险扣分 10%：经验断层、岗位不匹配、证据不足、过度包装、频繁转换等。",
        "",
        "请输出严格 JSON，格式如下：",
        "{",
        '  "summary": "整体横评结论，说明本次排序主要依据",',
        '  "decisionBasis": ["本次比较最关键的判断标准1", "判断标准2", "判断标准3"],',
        '  "ranked": [',
        '    {',
        '      "id": "候选人id",',
        '      "rank": 1,',
        '      "score": "88/100",',
        '      "reason": "核心排序理由，必须体现相对优势",',
        '      "evidence": ["来自简历的证据1", "来自简历的证据2"],',
        '      "concerns": ["主要风险或证据不足点"],',
        '      "fitLevel": "强匹配/可培养/备选/不优先"',
        "    }",
        "  ]",
        "}",
        "",
        "硬性要求：",
        "1. ranked 必须覆盖所有候选人 id。",
        "2. 必须按优先级从高到低排序。",
        "3. reason 不设字数上限；必须充分说明核心排序理由、相对优势、主要扣分点和不确定性，evidence/concerns 要具体。",
        "4. 如果岗位 JD 很长，不要复述 JD；只提炼影响排序的关键要求。",
        "5. 如果候选人 OCR 全文和结构化摘要冲突，优先引用更具体、可验证的信息，并在 concerns 里标注不确定性。",
        "",
        `候选人列表：\n${candidateBlock}`
    ].join("\n");
}

export function buildRankingApiConfig(baseConfig = {}) {
    return {
        ...baseConfig,
        maxTokens: 200000,
        temperature: 0.2,
        timeoutMs: Math.max(Number(baseConfig.timeoutMs || 0), 180000)
    };
}
