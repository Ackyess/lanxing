import { serverData, saveSettings } from "./data.js";
import { addLog } from "./ui.js";
import { saveToken } from "./token_store.js";
import {
	buildManualAIConfig,
	validateManualAIConfig,
	validateSecureApiBaseUrl,
	DEFAULT_MANUAL_AI_MODEL
} from "./ai_config.js";

const runtimeConfig = window.LANXING_CONFIG;

const DEFAULT_API_CONFIG = runtimeConfig ? runtimeConfig.DEFAULT_API : {
	baseUrl: '',
	maxTokens: 1024,
	temperature: 0.1
};

async function loadAIConfig() {
	try {
		if (serverData.ai_config && serverData.ai_config.token) {
			// console.log('使用已加载的AI配置:', serverData.ai_config);
			updateAIConfigUI();
			checkAIConnection();
			return;
		}
		
		const result = await chrome.storage.local.get('ai_config');
		if (result.ai_config) {
			serverData.ai_config = { ...serverData.ai_config, ...result.ai_config };
			// console.log('从本地存储加载AI配置:', serverData.ai_config);
			updateAIConfigUI();
		}

		checkAIConnection();
	} catch (error) {
		console.error('加载AI配置失败:', error);
	}
}

function updateAIConfigUI() {
	document.getElementById('ai-token').value = serverData.ai_config.token || '';
	const baseUrlInput = document.getElementById('ai-base-url');
	if (baseUrlInput) {
		baseUrlInput.value = serverData.ai_config.baseUrl || '';
	}

	const promptInput = document.getElementById('ai-click-prompt');

	selectModelInUI(serverData.ai_config.model);

	if (promptInput) {
		promptInput.value = serverData.ai_config.clickPrompt || '';
	}

	// 适配新 UI：没有 ai-model-info 容器，直接更新文本
	const currentModelText = document.getElementById('ai-current-model-text');

	if (currentModelText) {
		if (serverData.ai_config.model) {
			currentModelText.textContent = serverData.ai_config.model;
		} else {
			currentModelText.textContent = '未设置';
		}
	}

}

function showAIConfigModal() {
	document.getElementById('ai-config-modal')?.classList.add('active');
	updateAIConfigUI();
	refreshModelList();
}

function hideAIConfigModal() {
	document.getElementById('ai-config-modal')?.classList.remove('active');
}

// -----------------------------------------------------
// 模型列表：优先从上游 /v1/models 自动获取，失败保持预设
// -----------------------------------------------------
function selectModelInUI(model) {
	const modelSelect = document.getElementById('ai-model');
	const customModelInput = document.getElementById('ai-custom-model');
	if (!modelSelect || !customModelInput) return;

	const hasOption = [...modelSelect.options].some(
		(o) => o.value === model && o.value !== 'custom'
	);

	if (model && hasOption) {
		modelSelect.value = model;
		customModelInput.style.display = 'none';
	} else if (model) {
		modelSelect.value = 'custom';
		customModelInput.value = model;
		customModelInput.style.display = 'block';
	} else {
		modelSelect.selectedIndex = 0;
		customModelInput.style.display = 'none';
	}
}

function buildModelsUrl(baseUrl) {
	const raw = String(baseUrl || DEFAULT_API_CONFIG.baseUrl || '').trim();
	if (!raw) return '';
	const idx = raw.indexOf('/v1/');
	if (idx !== -1) return raw.slice(0, idx + 4) + 'models';
	return raw.replace(/\/+$/, '') + '/v1/models';
}

async function refreshModelList() {
	const modelSelect = document.getElementById('ai-model');
	if (!modelSelect) return;

	const token = (document.getElementById('ai-token')?.value || serverData.ai_config.token || '').trim();
	const base = (document.getElementById('ai-base-url')?.value || serverData.ai_config.baseUrl || '').trim();
	const url = buildModelsUrl(base);
	if (!url || !token) return; // 未配置时保持预设列表

	try {
		const resp = await fetch(url, {
			headers: { 'Authorization': `Bearer ${token}` },
		});
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const data = await resp.json();
		const ids = (Array.isArray(data.data) ? data.data : data.models || [])
			.map((m) => (typeof m === 'string' ? m : m?.id))
			.filter(Boolean)
			.sort();
		if (!ids.length) throw new Error('上游未返回模型');

		const currentModel = serverData.ai_config.model || modelSelect.value;
		modelSelect.innerHTML = '';
		for (const id of ids) {
			const opt = document.createElement('option');
			opt.value = id;
			opt.textContent = id;
			modelSelect.appendChild(opt);
		}
		const customOpt = document.createElement('option');
		customOpt.value = 'custom';
		customOpt.textContent = '自定义模型...';
		modelSelect.appendChild(customOpt);

		selectModelInUI(currentModel);
		addLog(`已从上游获取 ${ids.length} 个可用模型`, 'success');
	} catch (error) {
		addLog(`模型列表获取失败（${error.message}），使用预设列表`, 'warning');
	}
}

// 运行时按“具体 API 域名”申请可选主机权限（绕过 CORS 必需）。
// 默认安装只要 zhipin 权限，用户配置自定义 API 时才按需授权该单个域名，
// 而不是安装即索要“所有网站”。必须在用户手势内、作为首个 await 调用。
async function ensureApiHostPermission(baseUrl) {
	const raw = String(baseUrl || '').trim();
	if (!raw) return;
	let origin;
	try { origin = new URL(raw).origin; } catch { return; }
	if (!origin.startsWith('https://')) return;
	if (/(^|\.)zhipin\.com$/.test(new URL(raw).hostname)) return; // 已在必需权限内
	try {
		const granted = await chrome.permissions.request({ origins: [origin + '/*'] });
		if (!granted) {
			addLog(`未授予 ${origin} 的访问权限，AI 连接可能失败（重新保存可再次授权）`, 'warning');
		}
	} catch (e) {
		// 个别环境不支持可选权限，忽略
	}
}

async function saveAIConfig() {
	try {
		const tokenInput = document.getElementById('ai-token');
		const baseUrlInput = document.getElementById('ai-base-url');
		const modelSelect = document.getElementById('ai-model');
		const customModelInput = document.getElementById('ai-custom-model');

		// 不安全的外部地址（非 HTTPS 且非本机回环）在申请权限前就拒绝
		validateSecureApiBaseUrl(baseUrlInput?.value);

		// 首个 await：在用户手势内申请目标 API 域名权限
		await ensureApiHostPermission(baseUrlInput?.value);

		// token 输入框留空表示沿用当前会话中的 token（不覆盖）
		const enteredToken = String(tokenInput?.value || "").trim();
		const tokenToUse = enteredToken || serverData.ai_config.token || "";

		const nextConfig = buildManualAIConfig({
			token: tokenToUse,
			baseUrl: baseUrlInput?.value,
			selectedModel: modelSelect?.value,
			customModel: customModelInput?.value,
			platform: runtimeConfig?.DEFAULT_AI_CONFIG?.platform || 'custom',
			fallbackModel: runtimeConfig?.DEFAULT_AI_CONFIG?.model || DEFAULT_MANUAL_AI_MODEL
		});
		validateManualAIConfig(nextConfig);
		serverData.ai_config = {
			...serverData.ai_config,
			...nextConfig
		};

		// Token 加固：token 只写入会话（加密模式再加密落本地），绝不明文进 storage.local
		const tokenMode = document.getElementById('token-storage-select')?.value === 'encrypted' ? 'encrypted' : 'session';
		const tokenPassphrase = String(document.getElementById('token-passphrase')?.value || "");
		if (tokenToUse) {
			await saveToken(tokenToUse, { mode: tokenMode, passphrase: tokenPassphrase });
		}

		await saveSettings();

		hideAIConfigModal();
        
        // 立即更新主界面上的模型显示
        updateAIConfigUI();

		checkAIConnection();
		addLog('AI Token 已保存并生效', 'success');

		if (serverData.ai_config.token) {
			handleBalanceCheck();
		}
	} catch (error) {
			addLog('保存AI配置失败: ' + error.message, 'error');
	}
}

async function checkAIConnection() {
	const statusBadge = document.getElementById('ai-status-badge');
	const statusText = document.getElementById('ai-status-text');
	
	if (!serverData.ai_config.token && !serverData.ai_config.model) {
		if (statusBadge) statusBadge.className = 'ai-status-badge disconnected';
		if (statusText) statusText.textContent = '未配置';
		hideBalanceDisplay();
		return;
	}

	// console.log('检查AI功能是否可用...');
	const isAIAvailable = await checkAIAvailability();
	// console.log('AI功能是否可用:', isAIAvailable);
	if (!isAIAvailable) {
		if (statusBadge) statusBadge.className = 'ai-status-badge disconnected';
		if (statusText) statusText.textContent = 'AI功能已过期';
		hideBalanceDisplay();
		// console.log('AI功能不可用，显示"AI功能已过期"');
		return;
	}

	if (serverData.ai_config.token) {
		try {
			if (statusBadge) statusBadge.className = 'ai-status-badge';
			if (statusText) statusText.textContent = '连接中...';

			const testPrompt = '你好，这是一个连接测试。请回复"连接成功"。';
			const result = await sendDirectAIRequest(testPrompt);

			if (result.success) {
				if (statusBadge) statusBadge.className = 'ai-status-badge connected';
				if (statusText) statusText.textContent = '已连接';
				
				handleBalanceCheck();
			} else {
				if (statusBadge) statusBadge.className = 'ai-status-badge disconnected';
				if (statusText) statusText.textContent = '连接失败: ' + result.error;
				hideBalanceDisplay();
			}
		} catch (error) {
			if (statusBadge) statusBadge.className = 'ai-status-badge disconnected';
			if (statusText) statusText.textContent = '连接失败';
			console.error('AI连接测试失败:', error);
			hideBalanceDisplay();
		}
	} else {
		if (statusBadge) statusBadge.className = 'ai-status-badge disconnected';
		if (statusText) statusText.textContent = '* 请配置 AI API 密钥';
		hideBalanceDisplay();
		console.warn('AI 配置缺少 Token');
	}
}

async function checkAIAvailability() {
	return true;
}

// -----------------------------------------------------
// 统一使用 utils/ai_helper.js 发送请求
// -----------------------------------------------------
function getEffectiveApiConfig(apiOverrides = {}) {
	if (window.HR_AI_UTILS?.buildApiConfig) {
		return window.HR_AI_UTILS.buildApiConfig(apiOverrides, serverData.ai_config);
	}
	const baseUrl = String(apiOverrides?.baseUrl || serverData.ai_config?.baseUrl || DEFAULT_API_CONFIG.baseUrl || '').trim();
	return {
		...DEFAULT_API_CONFIG,
		...(apiOverrides || {}),
		baseUrl,
	};
}

async function sendDirectAIRequest(messages, apiOverrides = {}) {
    if (window.HR_AI_UTILS) {
        const apiConfig = getEffectiveApiConfig(apiOverrides);
        // 如果传入的是数组（messages格式），直接使用
        if (Array.isArray(messages)) {
             return await window.HR_AI_UTILS.sendRequest(apiConfig, serverData.ai_config, messages);
        } else {
             // 兼容旧代码：如果传入的是文本 prompt，构造成 simple user message
             const simpleMessages = [{ role: 'user', content: messages }];
             return await window.HR_AI_UTILS.sendRequest(apiConfig, serverData.ai_config, simpleMessages);
        }
    } else {
        console.error("HR_AI_UTILS 未加载");
        return { success: false, error: "AI 工具库未加载" };
    }
}

async function checkSiliconFlowBalance() {
	try {
		const apiConfig = getEffectiveApiConfig();
		if (!String(apiConfig.baseUrl || '').includes('siliconflow.cn')) {
			return { success: false, skipped: true, error: 'BALANCE_CHECK_UNSUPPORTED' };
		}

		if (!serverData.ai_config.token) {
			return { success: false, error: '未配置API Token' };
		}

		const response = await fetch('https://api.siliconflow.cn/v1/user/info', {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${serverData.ai_config.token}`,
				'Content-Type': 'application/json'
			}
		});

		if (!response.ok) {
			throw new Error(`API请求失败，HTTP状态码: ${response.status}`);
		}

		const data = await response.json();

		if (data.code === 20000 && data.status) {
			const balance = parseFloat(data.data.totalBalance) || 0;
			return {
				success: true,
				balance: balance,
				userInfo: data.data
			};
		} else {
			throw new Error(data.message || 'API响应异常');
		}
	} catch (error) {
		console.error('检查余额失败:', error);
		return {
			success: false,
			error: error.message
		};
	}
}

async function handleBalanceCheck() {
	try {
		const apiConfig = getEffectiveApiConfig();
		if (!String(apiConfig.baseUrl || '').includes('siliconflow.cn')) {
			hideBalanceDisplay();
			return;
		}

		addLog('检查硅基流动账号余额...', 'info');
		
		const result = await checkSiliconFlowBalance();

		if (result && result.success) {
			const balance = result.balance;
			addLog(`账号余额: ¥${balance.toFixed(2)}`, 'info');

			updateBalanceDisplay(balance);

			if (balance < 1) {
				const message = `当前Token对应的账号余额不足1元（当前余额: ¥${balance.toFixed(2)}）。\n\n可能会无法使用部分模型。\n\n你可以选择：\n1. 切换免费模型\n2. 前往硅基流动充值（首次需要实名认证）\n\n是否前往硅基流动官网充值？`;

				if (confirm(message)) {
					chrome.tabs.create({ url: 'https://cloud.siliconflow.cn/account/billing' });
				}

				addLog('余额不足，建议充值或切换免费模型', 'warning');
			} else {
				addLog('余额充足，可正常使用', 'success');
			}
		} else {
			addLog(`余额检查失败: ${result ? result.error : '未知错误'}`, 'error');
			hideBalanceDisplay();
		}
	} catch (error) {
		console.error('处理余额检查失败:', error);
		addLog(`余额检查异常: ${error.message}`, 'error');
		hideBalanceDisplay();
	}
}

function updateBalanceDisplay(balance) {
	// 适配新UI，只有 ai-balance-text
	const balanceText = document.getElementById('ai-balance-text');

	if (balanceText) {
		balanceText.textContent = `¥${balance.toFixed(2)}`;

		if (balance < 1) {
			balanceText.style.color = 'var(--danger)';
		} else if (balance < 5) {
			balanceText.style.color = 'var(--warning)';
		} else {
			balanceText.style.color = 'var(--success)';
		}
	}
}


function hideBalanceDisplay() {
	const balanceText = document.getElementById('ai-balance-text');
	if (balanceText) {
		balanceText.textContent = '--';
		balanceText.style.color = '';
	}
}


export {
	loadAIConfig,
	checkAIConnection,
	saveAIConfig,
	sendDirectAIRequest,
	showAIConfigModal,
	hideAIConfigModal,
	refreshModelList
};

