import { initializeFromServer } from "./data.js";
import { initPositionManager } from "./position.js";

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await initializeFromServer();
        initPositionManager();
    } catch (error) {
        console.error("初始化岗位管理页失败:", error);
        alert("初始化失败，请刷新页面或重启插件");
    }
});
