// 图片处理工具集
// 此文件被 content script 和 popup 共同引用

const LanxingImageUtils = {
    /**
     * 裁剪图片
     * @param {string} dataUrl - 图片 Base64
     * @param {object} options - { topRatio, bottomRatio }
     * @returns {Promise<string>} - 裁剪后的 Base64
     */
    async cropImage(dataUrl, { topRatio = 0, bottomRatio = 0 } = {}) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                const width = img.width;
                const totalHeight = img.height;
                
                const startY = totalHeight * topRatio;
                const endY = totalHeight * (1 - bottomRatio);
                const height = endY - startY;

                if (height <= 0) {
                    console.warn("[ImageUtils] 裁剪参数无效，返回原图");
                    resolve(dataUrl); 
                    return;
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, startY, width, height, 0, 0, width, height);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = (e) => reject(e);
            img.src = dataUrl;
        });
    },

    /**
     * 缩放并转换图片 (保持比例，背景填充白色，转JPG)
     * @param {string} dataUrl - 原图 Base64
     * @param {number} maxWidth - 最大宽度 (0 表示不缩放)
     * @param {number} quality - JPG 质量 (0-1)
     * @returns {Promise<string>} - 处理后的 Base64
     */
    async resizeAndCompressImage(dataUrl, maxWidth = 1000, quality = 0.9) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                // 只有当 maxWidth > 0 且原图宽大于 maxWidth 时才缩放
                if (maxWidth > 0 && width > maxWidth) {
                    const ratio = maxWidth / width;
                    width = maxWidth;
                    height = height * ratio;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                // JPG 背景填充白色，避免透明变黑
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                
                ctx.drawImage(img, 0, 0, width, height);
                
                // 输出高质量 JPG
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = (e) => reject(e);
            img.src = dataUrl;
        });
    },

    /**
     * 综合处理流程：裁剪 -> 缩放 -> 压缩
     * @param {string} dataUrl 
     * @param {object} options { crop: {topRatio, bottomRatio}, resize: {maxWidth, quality} }
     */
    async processImage(dataUrl, options = {}) {
        let result = dataUrl;

        // 1. 裁剪
        if (options.crop && (options.crop.topRatio > 0 || options.crop.bottomRatio > 0)) {
            result = await this.cropImage(result, options.crop);
        }

        // 2. 缩放与压缩
        const maxWidth = options.resize?.maxWidth ?? 1000;
        const quality = options.resize?.quality ?? 0.9;
        result = await this.resizeAndCompressImage(result, maxWidth, quality);

        return result;
    },

    /**
     * 保存截图到本地 (通用版)
     * @param {string} dataUrl - 图片数据
     * @param {string} [filename] - 文件名
     * @returns {Promise<string|number>} downloadId
     */
    async saveScreenshot(dataUrl, filename = null) {
        const safeFilename = filename?.replace(/[<>:"/\\|?*]/g, "_") || `lanxing_screenshot_${Date.now()}.png`;

        // 使用标准的 <a download> 触发下载（不需要 downloads 权限）
        if (typeof document === 'undefined') {
            throw new Error("当前环境不支持下载（缺少 DOM）");
        }

        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = safeFilename;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();

        return safeFilename;
    },

    /**
     * 截图 Canvas 区域 (通用版)
     * @param {object} rect {x, y, width, height, dpr?}
     * @param {number} [tabId] (可选) 如果提供，则发送消息到指定标签页；如果不提供，则尝试在当前环境(content script)直接查找
     * @returns {Promise<string>} base64 image data
     */
    async captureCanvasArea(rect, tabId = null) {
        if (!rect) {
            throw new Error("区域为空");
        }

        // 处理 dpr
        const dpr = rect.dpr || rect.devicePixelRatio || (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
        const normalizedRect = {
            ...rect,
            dpr: dpr
        };

        // ---------------------------------------------
        // 场景 1: Popup / Background 环境 (需要 tabId)
        // ---------------------------------------------
        if (tabId) {
            if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.sendMessage) {
                throw new Error("chrome.tabs API 不可用");
            }

            // console.log("[LanxingImageUtils] 尝试获取 Canvas 区域 (Remote)...", normalizedRect);
            
            // 发送消息到 content script
            
            // 这里我们只处理 "captureCanvasArea" (截图)
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: "CAPTURE_CANVAS_AREA",
                    data: normalizedRect
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        return reject(new Error(chrome.runtime.lastError.message));
                    }
                    if (!response?.success) {
                        return reject(new Error(response?.error || "截图失败"));
                    }
                    resolve(response.imageData);
                });
            });
        }

        // ---------------------------------------------
        // 场景 2: Content Script 环境 (直接调用 background)
        // ---------------------------------------------
        
        // 检查 chrome runtime
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
             return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'CAPTURE_CANVAS_AREA',  // 兼容旧习惯
                    type: 'CAPTURE_CANVAS_AREA',    // 新习惯
                    data: normalizedRect
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message || "截图请求失败"));
                        return;
                    }

                    if (response && (response.success || response.imageData)) {
                        resolve(response.imageData);
                    } else {
                        reject(new Error(response?.error || "截图失败，未返回数据"));
                    }
                });
            });
        }
        
        throw new Error("无法执行截图: 环境不支持");
    },

    /**
     * 获取简历 Canvas 区域 (通用版)
     * @param {number} [tabId] (可选) 如果提供，则发送消息到指定标签页(Popup模式)；如果不提供，则尝试在当前文档查找(Content模式)
     * @returns {Promise<object|null>} rect
     */
    async getResumeCanvasRect(tabId = null) {
        const MAX_RETRIES = 3;
        
        for (let i = 0; i < MAX_RETRIES; i++) {
            try {
                let rect = null;

                if (tabId) {
                    // Popup 模式: 发送消息给 Content Script
                    rect = await new Promise((resolve) => {
                        // 注意：BOSS 页面业务 DOM 经常在 iframe 内，直接 tabs.sendMessage 默认只到 top frame 会取不到 rect
                        chrome.runtime.sendMessage({
                            type: "LANXING_SEND_TO_BOSS_FRAME",
                            data: {
                                tabId,
                                target: "recommend",
                                message: { type: "GET_RESUME_RECT" },
                                timeoutMs: 8000
                            }
                        }, (resp) => {
                            if (chrome.runtime.lastError) {
                                resolve(null);
                                return;
                            }
                            resolve(resp?.data || null);
                        });
                    });
                } else {
                    // Content 模式: 本地查找
                    // 假设 findCanvasInDocument 和 getResumeCanvasRect 逻辑
                    // 由于 utils 是独立的，我们需要把查找逻辑搬过来或者依赖 window 下的方法
                    
                    // 尝试调用本地 legacy 方法 (如果存在)
                    if (typeof window.getResumeCanvasRect === 'function') {
                        rect = window.getResumeCanvasRect();
                    } else {
                        // 内置简单的查找逻辑 (作为 fallback)
                        const canvas = document.querySelector('canvas#resume');
                        if (canvas) {
                            const r = canvas.getBoundingClientRect();
                            rect = {
                                x: r.left + window.scrollX,
                                y: r.top + window.scrollY,
                                width: r.width,
                                height: r.height,
                                dpr: window.devicePixelRatio
                            };
                        }
                    }
                }

                if (rect && rect.width > 0 && rect.height > 0) {
                    return rect;
                }
            } catch (e) {
                console.warn("[LanxingImageUtils] getResumeCanvasRect error:", e);
            }

            // 等待重试
            await new Promise(r => setTimeout(r, 800));
        }
        return null;
    }
};

// 挂载到全局对象
if (typeof window !== 'undefined') {
    window.LanxingImageUtils = LanxingImageUtils;
} else if (typeof self !== 'undefined') {
    self.LanxingImageUtils = LanxingImageUtils;
}

// 尝试导出
try {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LanxingImageUtils;
    }
} catch (e) {}
