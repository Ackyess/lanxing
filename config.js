// 揽星 配置文件
const CONFIG = {
    // 硅基流动AI配置
    DEFAULT_API: {
        baseUrl: '',
        maxTokens: 1024,
        temperature: 0.1
    },
    DEFAULT_AI_CONFIG: {
        locked: false,
        platform: 'custom',
        token: '',
        model: 'gpt-5.5'
    },
    // 版本信息
    VERSION: '1.0',

    // 默认设置
    DEFAULTS: {
        matchLimit: 200,
        scrollDelayMin: 3,
        scrollDelayMax: 5,
        clickFrequency: 7,
        enableSound: true
    },

    // 运行模式配置
    RUN_MODE_CONFIG: {
        greetingEnabled: false,    // 是否启用打招呼功能
        communicationEnabled: true // 是否启用沟通处理功能
    }
};

// 如果在浏览器环境中，将配置暴露给全局
if (typeof window !== 'undefined') {
    window.LANXING_CONFIG = CONFIG;
}

if (typeof self !== 'undefined') {
    self.LANXING_CONFIG = CONFIG;
}

// 如果在Node.js环境中，导出配置
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
