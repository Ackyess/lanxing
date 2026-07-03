// 基础解析器类 - 包含共享的解析逻辑和配置
class BaseParser {
    constructor() {
        this.settings = null;
        this.filterSettings = null;
        // 添加高亮样式
        this.highlightStyles = {
            processing: `
                background-color: #fff3e0 !important;
                transition: background-color 0.3s ease;
                outline: 2px solid #ffa726 !important;
            `,
            matched: `
                background-color: #e8f5e9 !important;
                transition: background-color 0.3s ease;
                outline: 2px solid #4caf50 !important;
                box-shadow: 0 0 10px rgba(76, 175, 80, 0.3) !important;
            `
        };
        this.clickCandidateConfig = {
            enabled: true,
            frequency: 3,  // 默认每浏览10个点击3个
            viewDuration: [3, 5]  // 查看时间将从页面设置获取
        };
    }

    async loadSettings() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['keywords', 'isAndMode'], (result) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                this.settings = result;
                resolve(result);
            });
        });
    }

    setFilterSettings(settings) {
        this.filterSettings = settings;
    }

    // 基础的筛选方法
    filterCandidate(candidate) {
        if (!this.filterSettings) {
            //console.log('没有筛选设置，返回所有候选人');
            return true;  // 如果没有设置，默认匹配所有
        }

        // 合并所有需要匹配的文本
        const allText = candidate

        if (allText == null) {
            // alert("插件获取候选人文本失败");
            return false;
        }


        // 检查排除关键词
        if (this.filterSettings.excludeKeywords &&
            this.filterSettings.excludeKeywords.some(keyword =>
                allText.includes(keyword.toLowerCase())
            )) {
            // console.log('匹配到排除关键词');
            return false;
        }

        // 如果没有关键词，匹配所有
        if (!this.filterSettings.keywords || !this.filterSettings.keywords.length) {
            //console.log('没有设置关键词，匹配所有');
            return true;
        }

        if (this.filterSettings.isAndMode) {
            // 与模式：所有关键词都必须匹配
            return this.filterSettings.keywords.every(keyword => {
                if (!keyword) return true;
                return allText.includes(keyword.toLowerCase());
            });
        } else {

            // 或模式：匹配任一关键词即可
            return this.filterSettings.keywords.some(keyword => {
                if (!keyword) return false;
                return allText.includes(keyword.toLowerCase());
            });
        }
    }



    // 添加提取额外信息的方法
    extractExtraInfo(element, extraSelectors) {
        const extraInfo = [];
        if (Array.isArray(extraSelectors)) {
            extraSelectors.forEach(selector => {
                const elements = this.getElementsByClassPrefix(element, selector.prefix);
                if (elements.length > 0) {
                    elements.forEach(el => {
                        const info = el.textContent?.trim();
                        if (info) {
                            extraInfo.push({
                                type: selector.type || 'unknown',
                                value: info
                            });
                        }
                    });
                }
            });
        }
        return extraInfo;
    }

    // 获取所有匹配前缀的元素
    getElementsByClassPrefix(parent, prefix) {
        const elements = [];
        // 使用前缀开头匹配
        const startsWith = Array.from(parent.querySelectorAll(`[class^="${prefix}"]`));
        // 使用包含匹配
        const contains = Array.from(parent.querySelectorAll(`[class*=" ${prefix}"]`));

        return [...new Set([...startsWith, ...contains])];
    }

    // 添加基础的点击方法
    clickMatchedItem(element) {
        // 默认实现，子类可以覆盖
        console.warn('未实现点击方法');
        return false;
    }

    // 添加新方法
    setClickCandidateConfig(config) {
        this.clickCandidateConfig = {
            ...this.clickCandidateConfig,
            ...config
        };
    }

    // 基础的随机点击判断方法
    shouldClickCandidate() {
        if (!this.clickCandidateConfig.enabled) return false;
        let random = Math.random() * 10;
        // return false;
        return random <= (this.clickCandidateConfig.frequency);
    }

    // 获取随机查看时间
    getRandomViewDuration() {
        // 使用 filterSettings 中的延迟设置
        const min = this.filterSettings?.scrollDelayMin || 3;
        const max = this.filterSettings?.scrollDelayMax || 5;
        return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
    }

    // 基础的点击候选人方法（需要被子类重写）
    async clickCandidateDetail(element) {
        throw new Error('clickCandidateDetail method must be implemented by child class');
    }

    // 基础的关闭详情方法（需要被子类重写）
    async closeDetail() {
        throw new Error('closeDetail method must be implemented by child class');
    }
}

// Boss解析器类
class BossParser extends BaseParser {
    constructor() {
        super();
        // console.log('=== BossParser 构造函数开始 ===');

        // 定义完整的 class 名称

        //新牛人 recommend-card-list
        this.fullClasses = {
            container: 'card-list',
            items: ['candidate-card-wrap', 'geek-info-card', 'card-container', 'card-inner clear-fix'],
            name: 'name',
            age: 'job-card-left_labels__wVUfs',
            education: 'base-info join-text-wrap',
            university: 'content join-text-wrap',
            description: 'content',
            clickTarget: ['btn btn-greet', 'btn btn-getcontact search-btn-tip btn-prop-common prop-card-chat']
        };
        this.urlInfo = {
            url: '/web/chat/recommend',
            site: '推荐牛人'
        };

        // 定义部分 class 名称（用于模糊匹配）
        this.selectors = {
            container: 'card-list',
            items: ['candidate-card-wrap', 'card-inner clear-fix', 'card-container', 'geek-info-card'],
            name: 'name',
            age: ['job-card-left'],
            education: ['base-info join-text-wrap', 'geek-info-detail'],
            university: 'content join-text-wrap',
            description: 'content',
            clickTarget: ['btn btn-greet', 'btn btn-getcontact search-btn-tip btn-prop-common prop-card-chat'],
            activeText: 'active-text',
            continueButton:['btn btn-continue btn-outline'],

            extraSelectors: [
                { prefix: 'salary-text', type: '薪资' },
                { prefix: 'job-info-primary', type: '基本信息' },
                { prefix: 'tags-wrap', type: '标签' },
                { prefix: 'content join-text-wrap', type: '公司信息' }
            ],
            // 同事是否沟通过
            isContacted: ['colleague-collaboration']

        };

        // console.log('BossParser selectors:', this.selectors);

        // BOSS特定的选择器
        this.detailSelectors = {
            detailLink: ['card-inner common-wrap', 'card-inner clear-fix', 'candidate-card-wrap', 'card-inner blue-collar-wrap', 'card-container', 'geek-info-card', 'card-inner new-geek-wrap'],
            closeButton: ['boss-popup__close', 'resume-custom-close', 'boss-popup__close','dialog-wrap active'],
            closeButtonXpath: ['//*[@id="boss-dynamic-dialog-1j38fleo5"]/div/div[2]'],
            // 消息提示
            messageTip:'chat-global-entry',
            //消息列表元素
            messageListItem:'friend-list-item',
        };

        // console.log('BossParser detailSelectors:', this.detailSelectors);

        // 初始化数据拦截监听
        // console.log('开始初始化数据拦截监听...');
        this.initDataInterceptor();
        // console.log('=== BossParser 构造函数完成 ===');
        
        // 用于去重
        this.lastProcessedDataStr = '';
    }

    /**
     * 检查是否有消息提示，有就开始处理
     * @param {*} element 
     * @returns 
     */
    async checkMessageTip(element,phone,wechat,resume){

        //暂时不处理
        return false;
    }

    // 初始化数据拦截监听
    initDataInterceptor() {
        // 如果已经初始化过，直接返回
        if (this._interceptorInitialized) {
            // console.log('拦截器已初始化，跳过');
            return;
        }

        // 监听来自boss_interceptor.js的拦截数据
        window.addEventListener('message', (event) => {
            // console.log('=== 收到消息事件 ===');
            // console.log('消息来源:', event.source);
            // console.log('消息来源窗口名称:', event.source?.name);
            // console.log('当前窗口:', window);
            // console.log('当前窗口名称:', window.name);
            // console.log('消息数据:', event.data);
            // console.log('消息来源URL:', event.origin);

            // 仅接受 zhipin 各子域发来的消息，挡掉第三方 iframe 伪造（跨帧转发仍放行，因为都是 zhipin 域）
            try { if (!/(^|\.)zhipin\.com$/.test(new URL(event.origin).hostname)) return; } catch (_) { return; }

            // 允许来自boss-plugin的消息，无论来源窗口是什么
            // 因为iframe中的内容也可能发送数据
            const isValidSource = event.data && event.data.source === 'boss-plugin';
            if (!isValidSource) {
                // console.log('消息不符合BOSS插件数据格式，忽略');
                return;
            }

            if (event.data && event.data.source === 'boss-plugin') {
                // console.log('=== 检测到BOSS插件消息 ===');
                // console.log('消息类型:', event.data.type);
                // console.log('完整数据结构:', event.data);

                if (event.data.type === 'geek-list') {
                    // console.log('=== 处理候选人列表数据 ===');
                    if (event.data.data) {
                        const geekList = event.data.data.zpData.geekList || event.data.data.zpData.geeks;
                        // console.log('提取的候选人列表:', geekList);
                        // console.log('候选人数量:', Array.isArray(geekList) ? geekList.length : '非数组');

                        this.processInterceptedData(geekList);
                    } else {
                        // console.log('没有找到候选人数据内容');
                    }
                } else if (event.data.type === 'DATA_SROUCE') {
                    // console.log('=== 处理DATA_SROUCE消息 ===');
                    // 检查这个消息是否也包含候选人数据
                    if (event.data.data?.zpData) {
                        const geekList = event.data.data.zpData.geekList || event.data.data.zpData.geeks;
                        if (geekList && Array.isArray(geekList) && geekList.length > 0) {
                            // console.log('在DATA_SROUCE消息中发现候选人数据:', geekList.length, '个候选人');
                            this.processInterceptedData(geekList);
                        } else {
                            // console.log('DATA_SROUCE消息中没有候选人数据');
                        }
                    } else {
                        // console.log('DATA_SROUCE消息中没有zpData');
                    }
                } else if (event.data.type === 'IFRAME_DONE') {
                    // console.log('=== iframe加载完成 ===');
                    // console.log('iframe状态:', event.data.data);
                } else if (event.data.type === 'FIRST_LAYOUT') {
                    // console.log('=== 首次布局完成 ===');
                    // console.log('布局数据:', event.data.data);
                } else if (event.data.type === 'RUST_CALLBACK_VIP_POSITION') {
                    // console.log('=== VIP位置回调 ===');
                    // console.log('VIP数据:', event.data.data);
                } else {
                    // console.log('=== 其他BOSS插件消息类型 ===', event.data.type);
                }
            } else {
                // console.log('消息不符合BOSS插件数据格式，消息来源:', event.data?.source, '类型:', event.data?.type);
            }
        });
        
        this._interceptorInitialized = true;
    }

    // 处理拦截到的数据 todo
    async processInterceptedData(apiData) {
        try {
            // console.log('=== 开始处理拦截的API数据 ===');
            // console.log('API数据类型:', typeof apiData);
            // console.log('API数据长度:', Array.isArray(apiData) ? apiData.length : '非数组');
            // console.log('原始API数据:', apiData);

            if (apiData) {
                const candidates = apiData;

                // 简单的去重检查
                try {
                    // 使用 encryptId (如果存在) 或 姓名+公司 作为唯一标识生成指纹
                    const dataFingerprint = candidates.map(c => {
                        const card = c.geekCard;
                        return card ? (card.encryptId || (card.geekName + (card.expectPositionName || ''))) : 'unknown';
                    }).join('|');

                    if (dataFingerprint === this.lastProcessedDataStr) {
                        // console.log('=== 检测到重复的候选人数据，跳过处理 ===');
                        return;
                    }
                    this.lastProcessedDataStr = dataFingerprint;
                } catch (e) {
                    console.warn('生成数据指纹失败:', e);
                }

                // console.log('=== 候选人数据详情 ===');
                // 调试日志已禁用

                // 直接存储拦截到的数据
                // console.log('=== 保存候选人数据到缓存 ===');
                // 扩展可能在运行过程中被重载（context invalidated），此时直接跳过缓存，避免抛错打断主流程
                if (!chrome?.runtime?.id || !chrome?.storage?.local) {
                    return;
                }

                await new Promise((resolve) => {
                    chrome.storage.local.set({
                        bossZhipinCandidates: candidates
                    }, () => {
                        const err = chrome.runtime.lastError;
                        if (err) {
                            const msg = err.message || "";
                            if (msg.includes('Extension context invalidated')) {
                                // 静默跳过：等待用户刷新页面让新 content script 生效
                                resolve();
                                return;
                            }
                            console.error('保存缓存数据失败:', err);
                            resolve();
                            return;
                        }
                        resolve();
                    });
                });
            } else {
                // console.log('API数据为空');
            }
        } catch (error) {
            console.error('处理拦截数据失败:', error);
            console.error('错误详情:', error.stack);
        }
    }

    // 删除不再需要的合并方法

    // 添加一个新的查找元素的方法
    findElements() {
        let items = [];
        const docs = [document];

        // 查找所有iframe并添加到文档列表
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (iframeDoc) {
                    docs.push(iframeDoc);
                }
            } catch (error) {
                // 跨域iframe无法访问，跳过
            }
        }

        // 在所有文档中查找
        for (const doc of docs) {
            // 1. 首先尝试使用完整的 class 名称
            for (const item of this.fullClasses.items) {
                items = doc.getElementsByClassName(item);
                if (items.length > 0) {
                    return items;
                }
            }

            // 2. 尝试使用简单的 class 名称
            if (items.length === 0) {
                for (const item of this.selectors.items) {
                    items = doc.getElementsByClassName(item);
                    if (items.length > 0) {
                        return items;
                    }
                }
            }

            // 3. 尝试使用模糊匹配
            if (items.length === 0) {
                for (const item of this.fullClasses.items) {
                    items = doc.querySelectorAll(`[class*="${item}"]`);
                    if (items.length > 0) {
                        return items;
                    }
                }
            }

            // 4. 尝试使用前缀匹配
            if (items.length === 0) {
                for (const item of this.fullClasses.items) {
                    items = doc.querySelectorAll(`[class^="${item}"], [class*=" ${this.selectors.items}"]`);
                    if (items.length > 0) {
                        return items;
                    }
                }
            }
        }

        return items;
    }

    // 从缓存中获取候选人数据
    async getCachedCandidateData() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['bossZhipinCandidates'], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('获取缓存数据失败:', chrome.runtime.lastError);
                    resolve([]);
                    return;
                }
                resolve(result.bossZhipinCandidates || []);
            });
        });
    }

    // 根据候选人姓名从缓存中查找完整信息
    findCandidateFromCache(cachedData, candidateName) {
        if (!cachedData || !candidateName) return null;

        return cachedData.find(candidate =>
            candidate.geekCard && candidate.geekCard.geekName.toLowerCase().includes(candidateName.toLowerCase())
        );
    }

    //提取信息
    async extractCandidates(elements = null) {
        try {
            const candidates = [];
            let items = elements || await this.findElements();

            // console.log('=== 开始提取候选人 ===');
            // console.log('找到的元素数量:', items.length);

            if (!items || items.length === 0) {
                console.warn('未找到任何候选人元素');
                return [];
            }

            // 异步获取缓存数据
            const cachedData = await this.getCachedCandidateData();

            // 使用for循环顺序处理元素，确保所有异步操作完成
            for (const item of Array.from(items)) {
                try {
                    // this.highlightElement(item, 'processing');

                    // 提取候选人姓名
                    const nameElement = await this.findNameElement(item);
                    const candidateName = nameElement?.textContent?.trim() || '';
                    if (!candidateName) {
                        this.clearHighlight(item);
                        continue;
                    }
                    // console.log("查找:" + candidateName);

                    // 查找缓存或创建新候选人
                    const candidate = await this.processCandidate(item, candidateName, cachedData);
                    if (candidate) {
                        candidates.push(candidate);
                        // this.highlightElement(item, 'matched');
                    }

                } catch (error) {
                    console.error('处理候选人元素失败:', error);
                    this.clearHighlight(item);
                }
            }

            // console.log('=== 提取候选人完成 ===');
            // console.log('成功提取候选人数量:', candidates.length);
            candidates.forEach((candidate, index) => {
                // console.log(`候选人 ${index + 1}: ${candidate.name}`);
            });
            // console.log('=======================');

            return candidates;

        } catch (error) {
            console.error('提取候选人失败:', error);
            return []; // 出错时返回空数组
        }
    }

    // 查找元素方法
    findElement(fullClass, partialClass) {
        return (item) => {
            if (Array.isArray(partialClass)) {
                for (const className of partialClass) {
                    const element = item.getElementsByClassName(className)[0] ||
                        item.querySelector(`[class*="${className}"]`);
                    if (element) return element;
                }
            } else {
                return item.getElementsByClassName(fullClass)[0] ||
                    item.getElementsByClassName(partialClass)[0] ||
                    item.querySelector(`[class*="${partialClass}"]`);
            }
            return null;
        };
    }

    // 辅助方法：查找姓名元素
    async findNameElement(item) {
        return this.findElement(this.fullClasses.name, this.selectors.name)(item);
    }

    // 辅助方法：处理单个候选人
    // 从页面更新候选人信息
    async updateCandidateFromPage(candidate, item) {
        try {
            // 获取页面上的实时状态
            const pageActiveText = await this.findElement(this.fullClasses.activeText, this.selectors.activeText)(item)
                ?.textContent?.trim() || "离线";

            if (pageActiveText && pageActiveText !== "离线") {
                candidate.activeText = pageActiveText;
            }
            return candidate;
        } catch (error) {
            console.error('更新候选人页面信息失败:', error);
            return candidate;
        }
    }

    // 创建新候选人
    async createNewCandidate(item, candidateName) {
        try {
            const candidate = {
                name: candidateName,
                age: this.extractAge(await this.findElement(this.fullClasses.age, this.selectors.age)(item)?.textContent),
                education: await this.findElement(this.fullClasses.education, this.selectors.education)(item)?.textContent?.trim() || '',
                university: await this.findElement(this.fullClasses.university, this.selectors.university)(item)?.textContent?.trim() || '',
                description: await this.findElement(this.fullClasses.description, this.selectors.description)(item)?.textContent?.trim() || '',
                extraInfo: await this.extractExtraInfo(item, this.selectors.extraSelectors),
                timestamp: Date.now()
            };

            // console.log('=== 创建新候选人 ===');
            // console.log('姓名:', candidate.name);
            // console.log('年龄:', candidate.age);
            // console.log('学历:', candidate.education);
            // console.log('毕业院校:', candidate.university);
            // console.log('自我介绍:', candidate.description);
            // console.log('额外信息:', candidate.extraInfo);
            // console.log('时间戳:', candidate.timestamp);
            // console.log('==================');

            return candidate;
        } catch (error) {
            console.error('创建新候选人失败:', error);
            return null;
        }
    }

    async processCandidate(item, candidateName, cachedData) {
        const cachedCandidate = this.findCandidateFromCache(cachedData, candidateName);
        if (cachedCandidate) {
            // console.log(`使用缓存数据: ${candidateName}`);
            // 缓存里的候选人通常是接口原始结构（含 geekCard），不一定有 name 字段
            // 为后续统一使用（日志、截图命名、UI 显示）补齐 name
            if (!cachedCandidate.name) {
                cachedCandidate.name =
                    cachedCandidate?.geekCard?.geekName ||
                    cachedCandidate?.geekName ||
                    candidateName ||
                    '';
            }

            // return this.updateCandidateFromPage(cachedCandidate, item);
            return cachedCandidate;
        }

        // console.log(`创建新候选人: ${candidateName}`);
        return this.createNewCandidate(item, candidateName);
    }

    // 获取在线状态文本
    getActiveText(item) {
        let activeTextElement = findElement(this.fullClasses.activeText, this.selectors.activeText);
        if (!activeTextElement) {
            let onlineMarker = findElement('online-marker', 'online-marker');
            return onlineMarker ? "在线" : "离线";
        }
        return activeTextElement.textContent?.trim() || "离线";
    }

    extractAge(text) {
        if (!text) return 0;
        const matches = text.match(/(\d+)岁/);
        return matches ? parseInt(matches[1]) : 0;
    }

    async clickMatchedItem(element) {
        try {
            // 触发鼠标移入，确保按钮可见（有些卡片 hover 后才显示操作区）
            element.dispatchEvent(new MouseEvent('mouseover', {
                view: window,
                bubbles: true,
                cancelable: true
            }));

            const toCssSelector = (className) => {
                // 例如：'btn btn-greet' => '.btn.btn-greet'
                return '.' + String(className).trim().split(/\s+/).filter(Boolean).join('.');
            };

            const clickWithEvents = (el) => {
                if (!el) return false;
                try {
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    return true;
                } catch (e) {
                    try {
                        el.click();
                        return true;
                    } catch (_) {
                        return false;
                    }
                }
            };

            // 1) 优先按既有配置的 clickTarget（class 组合）查找
            for (const className of (this.selectors.clickTarget || [])) {
                const selector = toCssSelector(className);
                const candidates = Array.from(element.querySelectorAll(selector));
                for (const el of candidates) {
                    const text = (el.textContent || '').trim();
                    // 过滤非“打招呼”按钮的误点（例如“查看联系方式”等）
                    if (text && !text.includes('打招呼') && className.includes('btn-greet')) continue;
                    if (clickWithEvents(el)) return true;
                }
            }

            // 2) 文本兜底：在卡片内找“打招呼”按钮
            const buttons = Array.from(element.querySelectorAll('button, a, div[role="button"], span[role="button"]'));
            for (const btn of buttons) {
                const text = (btn.textContent || '').replace(/\s+/g, '');
                if (!text) continue;
                if (!text.includes('打招呼')) continue;
                if (btn.getAttribute('aria-disabled') === 'true') continue;
                if (btn instanceof HTMLButtonElement && btn.disabled) continue;
                if (clickWithEvents(btn)) return true;
            }

            return false;
        } catch (error) {
            console.error('点击元素时出错:', error);
            return false;
        }
    }

    // 实现点击候选人详情方法
    async clickCandidateDetail(element) {

        try {
            let detailLink = null;
            //this.detailSelectors.detailLink 是数组
            for (const className of this.detailSelectors.detailLink) {
                let element2 = element.getElementsByClassName(className)[0]
                if (element2) {
                    detailLink = element2;
                }
            }

            //console.log(detailLink);
            if (detailLink) {
                detailLink.click();
                // console.log('点击候选人详情成功');

                return true;
            } else {

                console.error('无法查找到详情class:', this.detailSelectors.detailLink);
            }
            return false;
        } catch (error) {
            console.error('点击候选人详情失败:', error);
            return false;
        }
    }

    // 递归查找并点击关闭按钮
    findAndClickCloseButton(doc, depth = 0, maxDepth = 5) {
        if (depth > maxDepth) return false;

        const indent = '  '.repeat(depth);
        // console.log(`${indent}[BOSS] 在文档中查找关闭按钮，深度: ${depth}`);

        // 1. 通过类名查找
        for (const className of this.detailSelectors.closeButton) {
            const closeElements = doc.getElementsByClassName(className);
            if (closeElements.length > 0) {
                // console.log(`${indent}[BOSS] 找到关闭按钮: ${className}`);
                closeElements[0].click();
                return true;
            }
        }

        // 2. 通过选择器查找
        const closeSelectors = [
            '.boss-popup__close',
            '.resume-custom-close',
            '[class*="close"]',
            'button[aria-label="关闭"]',
            '.dialog-wrap .close'
        ];

        for (const selector of closeSelectors) {
            const closeBtn = doc.querySelector(selector);
            if (closeBtn) {
                // console.log(`${indent}[BOSS] 通过选择器找到关闭按钮: ${selector}`);
                closeBtn.click();
                return true;
            }
        }

        // 3. 通过XPath查找
        for (const xpath of this.detailSelectors.closeButtonXpath) {
            try {
                const element = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                if (element) {
                    // console.log(`${indent}[BOSS] 通过XPath找到关闭按钮: ${xpath}`);
                    element.click();
                    return true;
                }
            } catch (error) {
                // console.log(`${indent}[BOSS] XPath查找失败: ${error.message}`);
            }
        }

        // 4. 递归查找iframe
        const iframes = doc.querySelectorAll('iframe');
        // console.log(`${indent}[BOSS] 当前文档iframe数量: ${iframes.length}`);
        
        for (const iframe of iframes) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (iframeDoc && this.findAndClickCloseButton(iframeDoc, depth + 1, maxDepth)) {
                    return true;
                }
            } catch (error) {
                // console.log(`${indent}[BOSS] iframe访问失败: ${error.message}`);
            }
        }

        return false;
    }

    // 实现关闭详情方法
    async closeDetail(maxRetries = 3) {
        try {
            // console.log('[BOSS] 开始关闭详情页，剩余重试次数:', maxRetries);

            // 递归深度限制，避免无限循环
            if (maxRetries <= 0) {
                console.warn('[BOSS] 关闭详情已达到最大重试次数');
                return false;
            }

            // 递归查找并点击关闭按钮
            const closed = this.findAndClickCloseButton(document);
            
            if (!closed) {
                console.warn('[BOSS] 未找到任何关闭按钮');
            } else {
                // console.log('[BOSS] 已点击关闭按钮');
            }

            // 等待DOM更新和动画完成（增加等待时间）
            // console.log('[BOSS] 等待DOM更新和弹窗关闭动画...');
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 检查是否还有未关闭的弹框
            const stillHasModals = this.checkForRemainingModals();

            if (stillHasModals) {
                // console.log('[BOSS] 检测到还有未关闭的弹框，继续尝试关闭');
                return await this.closeDetail(maxRetries - 1);
            }

            // console.log('[BOSS] 详情页关闭成功');
            return true;

        } catch (error) {
            console.error('[BOSS] 关闭详情失败:', error);
            return false;
        }
    }

    // 递归检查文档中是否有canvas
    checkCanvasInDocument(doc, depth = 0, maxDepth = 5) {
        if (depth > maxDepth) return false;

        // 检查当前文档
        if (doc.querySelector('canvas#resume')) {
            return true;
        }

        // 检查iframe
        const iframes = doc.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (iframeDoc && this.checkCanvasInDocument(iframeDoc, depth + 1, maxDepth)) {
                    return true;
                }
            } catch (error) {
                // 跨域iframe无法访问
            }
        }

        return false;
    }

    // 检查是否还有未关闭的弹框
    checkForRemainingModals() {
        // 1. 检查关闭按钮是否还存在
        for (const className of this.detailSelectors.closeButton) {
            if (document.getElementsByClassName(className).length > 0) {
                // console.log(`[BOSS] 发现未关闭的弹框: ${className}`);
                return true;
            }
        }

        // 2. 检查XPath定位的弹框
        for (const xpath of this.detailSelectors.closeButtonXpath) {
            const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (element) {
                // console.log(`[BOSS] 发现未关闭的弹框: ${xpath}`);
                return true;
            }
        }

        // 3. 检查是否还有可见的dialog/modal
        const dialogSelectors = [
            '.boss-popup__wrap',
            '.dialog-wrap.active',
            '[class*="dialog"][style*="display: block"]',
            '[class*="modal"][style*="display: block"]'
        ];

        for (const selector of dialogSelectors) {
            const dialogs = document.querySelectorAll(selector);
            if (dialogs.length > 0) {
                // console.log(`[BOSS] 发现未关闭的dialog: ${selector}`);
                return true;
            }
        }

        // 4. 递归检查canvas#resume是否还存在（说明详情页还在）
        if (this.checkCanvasInDocument(document)) {
            // console.log('[BOSS] canvas#resume还存在，详情页未关闭');
            return true;
        }

        // console.log('[BOSS] 未发现残留的弹框');
        return false;
    }

    //查询同事沟通过候选人的信息
    async queryColleagueContactedInfo(candidate) {
        try {
            //参考boss_resume_downloader.js中的processNextCandidate方法
            for (let i = 0; i <= this.selectors.isContacted.length; i++) {
                let aaa = document.getElementsByClassName(this.selectors.isContacted[i]);
                if (aaa.length > 0) {
                    return aaa[0].textContent.trim();
                } else {
                }
            }
        } catch (error) {
            console.error('查询同事沟通过候选人的信息失败:', error);
        }
    }

    // 获取候选人简单信息（用于AI决策）
    getSimpleCandidateInfo(candidate) {
        if (!candidate) return '候选人信息为空';

        const info = [];

        // console.log('=== AI决策候选人信息 ===');
        // console.log('原始候选人数据:', candidate);

        // 基本信息
        if (candidate.geekCard) {
            const gc = candidate.geekCard;
            // console.log('基本信息 - geekCard:', gc);

            info.push(`姓名: ${gc.geekName || '未知'}`);
            info.push(`年龄: ${gc.ageDesc || '未知'}`);
            info.push(`学历: ${gc.geekDegree || '未知'}`);
            info.push(`毕业院校: ${gc.geekEdu?.school || '未知'}`);
            info.push(`专业: ${gc.geekEdu?.major || '未知'}`);
            info.push(`工作年限: ${gc.geekWorkYear || '未知'}`);
            info.push(`当前状态: ${gc.applyStatusDesc || '未知'}`);
            info.push(`期望薪资: ${gc.salary || '未知'}`);
            info.push(`期望职位: ${gc.expectPositionName || '未知'}`);
            info.push(`期望地点: ${gc.expectLocationName || '未知'}`);

            if (gc.geekDesc?.content) {
                info.push(`自我介绍: ${gc.geekDesc.content}`);
            }
        }

        const result = info.join('\n');
        // console.log('=== AI决策最终信息 ===');
        // console.log(result);
        // console.log('========================');

        return result;

    }
}

// 将 BossParser 暴露到全局作用域
window.BossParser = BossParser;
