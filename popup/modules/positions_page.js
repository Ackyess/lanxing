import { initializeFromServer } from "./data.js";
import { initPositionManager } from "./position.js";

document.addEventListener("DOMContentLoaded", async () => {
    // 关闭按钮改为 JS 绑定，移除内联 onclick（扩展特权页不放行内联事件处理器）
    document.getElementById("position-close-btn")?.addEventListener("click", () => window.close());

    try {
        await initializeFromServer();
        initPositionManager();
    } catch (error) {
        console.error("初始化岗位管理页失败:", error);
        alert("初始化失败，请刷新页面或重启插件");
    }
});
