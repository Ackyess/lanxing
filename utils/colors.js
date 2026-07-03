// 颜色配置管理
// 此文件被 content script 和 popup 共同引用

const HR_COLORS = {
    // 状态颜色
    PROCESSING: {
        border: '#ffa726',        // 橘色边框
        background: '#fff3e0',    // 浅橘色背景
        rgbBorder: 'rgb(255, 167, 38)', // 用于样式匹配检查
        rgbBg: 'rgb(255, 243, 224)'     // 用于样式匹配检查
    },
    SUCCESS: {
        border: '#4caf50',        // 绿色边框
        background: '#e8f5e9',    // 浅绿色背景
        rgbBorder: 'rgb(76, 175, 80)',
        rgbBg: 'rgb(232, 245, 233)'
    },
    FAIL: {
        border: '#ef4444',        // 红色边框
        background: '#ffebee',    // 浅红色背景
        rgbBorder: 'rgb(239, 68, 68)',
        rgbBg: 'rgb(255, 235, 238)'
    },
    DEFAULT: {
        border: '#9e9e9e',        // 灰色边框
        background: '#f5f5f5',    // 浅灰色背景
        rgbBorder: 'rgb(158, 158, 158)',
        rgbBg: 'rgb(245, 245, 245)'
    }
};

// 辅助方法：检查样式字符串是否包含某种状态的颜色
HR_COLORS.isState = function(styleString, stateKey) {
    if (!styleString || !HR_COLORS[stateKey]) return false;
    const config = HR_COLORS[stateKey];
    return styleString.includes(config.border) || 
           styleString.includes(config.rgbBorder) || 
           styleString.includes(config.background) || 
           styleString.includes(config.rgbBg);
};

// 辅助方法：检查是否已处理（成功或失败）
HR_COLORS.isProcessed = function(styleString) {
    return this.isState(styleString, 'SUCCESS') || this.isState(styleString, 'FAIL');
};

// 挂载到全局对象，兼容不同环境
if (typeof window !== 'undefined') {
    window.HR_COLORS = HR_COLORS;
} else if (typeof self !== 'undefined') {
    self.HR_COLORS = HR_COLORS;
}

// 尝试导出 (兼容 module 环境)
try {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = HR_COLORS;
    }
} catch (e) {}

