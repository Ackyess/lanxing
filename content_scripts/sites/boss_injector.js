// Boss拦截器注入器 - 在document_start时运行
(function injectBossInterceptor() {
    'use strict';


    // 创建script元素注入拦截器
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content_scripts/sites/boss_interceptor.js');
    script.async = false;

    // 把账号安全模式广播给页面上下文的拦截器：
    // 严格模式下 hook 仍会安装（时序上无法条件安装），但处于惰性——
    // 不转发任何 fetch/XHR/postMessage 数据、也不响应主动 fetch，
    // 尽量减少“严格模式=不碰平台”与 API-hook 足迹之间的矛盾。
    const ACCOUNT_SAFETY_MODE_KEY = 'lanxing_account_safety_mode';
    function broadcastSafetyMode() {
        try {
            chrome.storage.local.get(ACCOUNT_SAFETY_MODE_KEY, (res) => {
                if (chrome.runtime && chrome.runtime.lastError) return;
                const strict = (res && res[ACCOUNT_SAFETY_MODE_KEY]) !== 'advanced';
                window.postMessage({ source: 'lanxing', type: 'LANXING_SAFETY_MODE', strict }, window.location.origin);
            });
        } catch (e) {
            // 读取失败时默认严格：拦截器保持关闭
            try { window.postMessage({ source: 'lanxing', type: 'LANXING_SAFETY_MODE', strict: true }, window.location.origin); } catch (_) {}
        }
    }

    // 注入到页面
    (document.head || document.documentElement).appendChild(script);
    script.onload = function () {
        script.parentNode && script.parentNode.removeChild(script);
        broadcastSafetyMode(); // 拦截器已就绪，告知当前模式
    };

    script.onerror = function () {
        console.error('❌ BossAPI拦截器注入失败');
    };

    // 首次尽快广播 + 模式变更时同步
    broadcastSafetyMode();
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes && changes[ACCOUNT_SAFETY_MODE_KEY]) {
                broadcastSafetyMode();
            }
        });
    } catch (e) {
        // ignore
    }

})();