// Boss拦截器注入器 - 在document_start时运行
(function injectBossInterceptor() {
    'use strict';


    // 创建script元素注入拦截器
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content_scripts/sites/boss_interceptor.js');
    script.async = false;

    // 注入到页面
    (document.head || document.documentElement).appendChild(script);
    script.onload = function () {
        script.parentNode && script.parentNode.removeChild(script);
    };

    script.onerror = function () {
        console.error('❌ BossAPI拦截器注入失败');
    };

})();