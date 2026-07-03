// BossAPI拦截器 - 在document_start时注入
(function () {
    'use strict';

    // console.log('=== Boss拦截器初始化 ===');
    // console.log('当前窗口:', window);
    // console.log('窗口名称:', window.name);
    // console.log('是否在iframe中:', window.parent && window.parent !== window);
    // console.log('父窗口:', window.parent);

    // 先保存原始 fetch，后续用于页面上下文主动请求（避免递归拦截）
    const originalFetch = window.fetch;

    const TARGET_RULES = [
        // 候选人列表
        { pattern: '/wapi/zprelation/interaction/bossGetGeek', type: 'geek-list' },
        { pattern: '/wapi/zpjob/rec/geek/list', type: 'geek-list' },
        { pattern: '/wapi/zpitem/web/refinedGeek/list', type: 'geek-list' },
        { pattern: '/wapi/zpitem/web/boss/search', type: 'geek-list' },

        // 职位列表（web/chat/job/list 页面通常由该接口驱动）
        { pattern: '/wapi/zpjob/job/data/list', type: 'job-list' },

        // 职位预览（包含更完整的职位详情）
        { pattern: '/wapi/zpjob/job/job/preview', type: 'job-preview' }
    ];

    function matchTargetRule(url) {
        if (!url) return null;
        for (const rule of TARGET_RULES) {
            if (url.includes(rule.pattern)) return rule;
        }
        return null;
    }

    function isAllowedFetchUrl(url) {
        try {
            const u = new URL(url, location.origin);
            if (u.origin !== location.origin) return false;
            const rule = matchTargetRule(u.toString());
            return !!rule && (rule.type === 'job-list' || rule.type === 'job-preview');
        } catch (e) {
            return false;
        }
    }

    // 允许 content script 通过 postMessage 触发页面上下文 fetch（避免 CSP inline script）
    window.addEventListener('message', async (event) => {
        try {
            if (event.source !== window) return;
            const msg = event.data;
            if (!msg || msg.source !== 'lanxing' || msg.type !== 'LANXING_FETCH') return;

            const requestId = msg.requestId || '';
            const url = msg.url || '';
            if (!requestId || typeof requestId !== 'string') return;
            if (!url || typeof url !== 'string') return;
            if (!isAllowedFetchUrl(url)) {
                window.postMessage({
                    source: 'boss-plugin',
                    type: 'lanxing-fetch-error',
                    requestId,
                    url,
                    error: 'URL_NOT_ALLOWED'
                }, '*');
                return;
            }

            const rule = matchTargetRule(url);
            const res = await originalFetch(url, {
                method: 'GET',
                credentials: 'include',
                headers: { 'accept': 'application/json, text/plain, */*' }
            });

            const cloned = res.clone();
            const contentType = cloned.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                window.postMessage({
                    source: 'boss-plugin',
                    type: 'lanxing-fetch-error',
                    requestId,
                    url,
                    status: cloned.status,
                    error: 'NOT_JSON'
                }, '*');
                return;
            }

            const data = await cloned.json();
            window.postMessage({
                source: 'boss-plugin',
                type: rule?.type || 'lanxing-fetch',
                requestId,
                transport: 'lanxing-fetch',
                url: cloned.url,
                ok: cloned.ok,
                status: cloned.status,
                data
            }, '*');
        } catch (e) {
            try {
                const msg = event?.data;
                window.postMessage({
                    source: 'boss-plugin',
                    type: 'lanxing-fetch-error',
                    requestId: msg?.requestId || '',
                    url: msg?.url || '',
                    error: e?.message || String(e)
                }, '*');
            } catch (_) {
                // ignore
            }
        }
    });


    function publishInterceptedFetchResponse(rule, cloned) {
        return cloned.json().then((data) => {
            // 发送拦截数据 - 同时发送给当前窗口和父窗口
            // 先发送给当前窗口（如果在iframe中）
            window.postMessage({
                source: 'boss-plugin',
                type: rule.type,
                transport: 'fetch',
                url: cloned.url,
                ok: cloned.ok,
                status: cloned.status,
                data
            }, '*');

            // 如果在iframe中，也发送给父窗口
            if (window.parent && window.parent !== window) {
                try {
                    window.parent.postMessage({
                        source: 'boss-plugin',
                        type: rule.type,
                        transport: 'fetch',
                        url: cloned.url,
                        ok: cloned.ok,
                        status: cloned.status,
                        data
                    }, '*');
                } catch (e) {
                    console.error('发送消息到父窗口失败:', e);
                }
            }
        }).catch((e) => {
            console.error('❌ 拦截fetch响应解析出错:', e);
        });
    }

    // Hook fetch API
    window.fetch = function (...args) {
        const [input, init] = args;
        const url = typeof input === 'string' ? input : input && input.url;
        const rule = matchTargetRule(url);

        // Do not await or wrap unrelated page requests. If they fail, the error
        // should stay attributed to the page's own fetch chain, not 揽星.
        if (!rule) {
            return originalFetch.apply(this, args);
        }

        return originalFetch.apply(this, args).then((res) => {
            try {
                const cloned = res.clone();
                const contentType = cloned.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    publishInterceptedFetchResponse(rule, cloned);
                }
            } catch (e) {
                console.error('❌ 拦截fetch请求时出错:', e);
            }
            return res;
        });
    };

    // Hook XHR API
    const OriginalXHR = window.XMLHttpRequest;

    function WrappedXHR() {
        const xhr = new OriginalXHR();
        let requestUrl = '';

        const open = xhr.open;
        xhr.open = function (method, url, ...rest) {
            requestUrl = url;
            return open.call(xhr, method, url, ...rest);
        };

        xhr.addEventListener('load', function () {
            try {
                const rule = matchTargetRule(requestUrl);
                if (rule) {
                    const contentType = xhr.getResponseHeader('content-type') || '';

                    if (contentType.includes('application/json')) {
                        let data;
                        try {
                            data = JSON.parse(xhr.responseText);
                        } catch (e) {
                            data = null;
                            console.error('❌ 解析JSON失败:', e);
                        }

                        // 发送拦截数据 - 同时发送给当前窗口和父窗口
                        // 先发送给当前窗口（如果在iframe中）
                        window.postMessage({
                            source: 'boss-plugin',
                            type: rule.type,
                            transport: 'xhr',
                            url: requestUrl,
                            status: xhr.status,
                            data
                        }, '*');

                        // 如果在iframe中，也发送给父窗口
                        if (window.parent && window.parent !== window) {
                            try {
                                window.parent.postMessage({
                                    source: 'boss-plugin',
                                    type: rule.type,
                                    transport: 'xhr',
                                    url: requestUrl,
                                    status: xhr.status,
                                    data
                                }, '*');
                            } catch (e) {
                                console.error('发送XHR消息到父窗口失败:', e);
                            }
                        }
                    } else {
                        const text = xhr.responseText;
                    }
                }
            } catch (e) {
                console.error('❌ 拦截XHR请求时出错:', e);
            }
        });

        return xhr;
    }

    // 监听页面内部的postMessage
    const originalPostMessage = window.postMessage;
    window.postMessage = function(message, targetOrigin, transfer) {
        // 拦截页面内部的消息
        try {
            if (message && typeof message === 'object') {
                // 检查是否是BOSS相关的消息
                if (message.type && (
                    message.type.includes('RESUME') ||
                    message.type.includes('GEEK') ||
                    message.type.includes('DETAIL') ||
                    message.type.includes('SET_') ||
                    message.type.includes('DATA_')
                )) {
                    // console.log('=== 拦截到页面内部消息 ===');
                    // console.log('消息类型:', message.type);
                    // console.log('消息数据:', message);

                    // 发送给父窗口
                    if (window.parent && window.parent !== window) {
                        try {
                            window.parent.postMessage({
                                source: 'boss-plugin',
                                type: message.type,
                                transport: 'internal-message',
                                data: message.data || message,
                                originalMessage: message
                            }, '*');
                        } catch (e) {
                            console.error('发送内部消息到父窗口失败:', e);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('拦截postMessage失败:', e);
        }

        // 调用原始方法
        return originalPostMessage.call(this, message, targetOrigin, transfer);
    };

    window.XMLHttpRequest = WrappedXHR;

})();
