// compliance.js — AI 话术/理由合规脱敏
// 账号安全模式下，即使 AI 文本只做展示，也对高风险内容兜底脱敏，
// 避免出现诱导站外沟通、索取隐私、夸张承诺等 BOSS 风控敏感词。
// 此文件被 content script 与 popup 共同引用。

(function () {
    'use strict';

    // 命中即整体替换为遮挡块。顺序不敏感，全部为全局匹配。
    const PATTERNS = [
        // 站外引流 / 联系方式
        /微\s*信/g, /\bVX\b/gi, /\bwechat\b/gi, /\bQQ\b/gi, /扫\s*码/g, /二维码/g,
        /加\s*群/g, /私\s*聊/g, /站\s*外/g, /下载[^，。\s]{0,6}(APP|软件|应用)/gi,
        // 诈骗 / 灰产话术
        /日\s*结/g, /高薪轻松/g, /轻松高薪/g, /零门槛/g, /无门槛/g,
        /兼\s*职/g, /副\s*业/g, /垫\s*资/g, /押\s*金/g, /保证金/g, /培训费/g, /刷\s*单/g,
        // 隐私 / 敏感材料
        /身份证/g, /银行卡/g, /验证码/g
    ];

    function filterText(text) {
        const orig = String(text || '');
        let out = orig;
        for (const p of PATTERNS) {
            out = out.replace(p, '▇▇');
        }
        return { text: out, redacted: out !== orig };
    }

    const api = { filterText };

    if (typeof window !== 'undefined') window.LANXING_COMPLIANCE = api;
    if (typeof self !== 'undefined') self.LANXING_COMPLIANCE = api;

    try {
        if (typeof module !== 'undefined' && module.exports) module.exports = api;
    } catch (e) { /* ignore */ }
})();
