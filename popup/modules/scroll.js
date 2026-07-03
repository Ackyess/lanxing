import { serverData, saveState, runtimeState, aiConfigForContent } from "./data.js";
import { addLog, updateUI } from "./ui.js";
import { sendToBossFrame } from "./frame_bridge.js";
import { buildBatchPlan } from "./batch_plan.js";

export async function startAutoScroll() {
	const batchPlan = buildBatchPlan({
		batchConfig: serverData.batchConfig,
		positions: serverData.positions,
	});
	if (!batchPlan && !serverData.currentPosition) {
		addLog('⚠️ 请先选择岗位', 'error');
		runtimeState.isRunning = false;
		updateUI({ isRunning: runtimeState.isRunning, isDownloading: runtimeState.isDownloading });
		return;
	}

	// Token 已隔离到 background，content 侧不再校验 token，这里在 popup 侧先把关
	if (!serverData.ai_config?.token) {
		addLog('请先在「设置」里配置 AI Token', 'error');
		return;
	}

	if (runtimeState.isRunning) return;

	try {
		runtimeState.isRunning = true;
		runtimeState.matchCount = 0;
		updateUI({ isRunning: runtimeState.isRunning, isDownloading: runtimeState.isDownloading });
		
		await chrome.storage.local.set({ isRunning: true });
		
		// 批量模式：每个岗位单独数量；单岗位模式：沿用 serverData.matchLimit（可在设置里调整）
		if (!batchPlan) {
			const matchLimitInput = document.getElementById('match-limit');
			serverData.matchLimit = parseInt(matchLimitInput?.value) || serverData.matchLimit || 200;
		}

		addLog('开始AI智能筛选...', 'info');
		if (batchPlan) {
			addLog(`队列模式：共 ${batchPlan.length} 个岗位，将按顺序依次执行`, 'info');
			// 打印队列明细（便于确认：选了哪些岗位、各自数量）
			batchPlan.forEach((p, idx) => {
				addLog(`${idx + 1}. ${p.positionName} × ${p.matchLimit}`, 'info');
			});
			addLog(`每个岗位数量范围：1-200（达到数量自动切换下一个）`, 'info');
		} else {
			addLog(`设置打招呼暂停数: ${serverData.matchLimit}`, 'info');
		}
		addLog(`随机延迟时间ai: ${serverData.scrollDelayMin || 3}-${serverData.scrollDelayMax || 5}秒`, 'info');

		try {
			const plan = batchPlan || null;
			const first = plan?.[0] || null;
			const startResp = await sendToBossFrame({
				target: "recommend",
				message: {
					action: "START_AI_SCROLL",
					data: {
						positionId: first?.positionId || serverData.currentPosition.id,
						positionName: first?.positionName || serverData.currentPosition.name,
						jobDescription: first?.jobDescription || serverData.currentPosition.description,
						aiConfig: aiConfigForContent(),
						matchLimit: first?.matchLimit || serverData.matchLimit,
						batchPlan: plan,
						scrollDelayMin: serverData.scrollDelayMin || 3,
						scrollDelayMax: serverData.scrollDelayMax || 5,
						clickFrequency: serverData.clickFrequency || 7,
						enableSound: serverData.enableSound || false,
						greetingEnabled: serverData.runModeConfig?.greetingEnabled === true,
						communicationConfig: serverData.communicationConfig
					}
				},
				timeoutMs: 20000
			});

			// 若内容脚本因账号安全模式拦截了启动，回滚 UI 的“运行中”状态（终审 #4）
			if (startResp?.data?.blocked) {
				addLog("账号安全模式已开启：全自动运行已被拦截", "warning");
				runtimeState.isRunning = false;
				updateUI({ isRunning: runtimeState.isRunning, isDownloading: runtimeState.isDownloading });
				await chrome.storage.local.set({ isRunning: false });
				return;
			}
		} catch (e) {
			console.error("发送消息失败:", e);
			addLog("⚠️ 无法连接到页面，请刷新页面", "error");
			runtimeState.isRunning = false;
			updateUI({ isRunning: runtimeState.isRunning, isDownloading: runtimeState.isDownloading });
			return;
		}

		await saveState();
	} catch (error) {
		console.error('启动失败:', error);
		runtimeState.isRunning = false;
		updateUI({ isRunning: runtimeState.isRunning, isDownloading: runtimeState.isDownloading });
		addLog('启动失败: ' + error.message, 'error');
	}
}

export async function stopAutoScroll() {
	if (!runtimeState.isRunning) return;

	try {
		runtimeState.isRunning = false;
		updateUI({ isRunning: runtimeState.isRunning, isDownloading: runtimeState.isDownloading });
		addLog(`停止自动执行`, 'warning');

		try {
			await sendToBossFrame({
				target: "recommend",
				message: { action: "STOP_SCROLL" },
				timeoutMs: 8000
			});
		} catch (e) {
			console.error("发送停止消息失败:", e);
		}

		await chrome.storage.local.set({
			isRunning: false
		});
	} catch (error) {
		console.error('停止失败:', error);
		addLog('停止失败: ' + error.message, 'error');
	} finally {
		runtimeState.matchCount = 0;
		runtimeState.isRunning = false;
		updateUI({ isRunning: runtimeState.isRunning, isDownloading: runtimeState.isDownloading });
	}
}
