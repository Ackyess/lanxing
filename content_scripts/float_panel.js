// 揽星 页内浮窗：可拖动的 iframe 容器（仅注入顶层页面，all_frames:false + 双保险）
(function () {
    if (window.top !== window) return;

    const PANEL_ID = "lanxing-float-panel";
    const POS_KEY = "lanxing_float_pos";

    chrome.runtime.onMessage.addListener((msg) => {
        if ((msg.type || msg.action) !== "LANXING_TOGGLE_FLOAT_PANEL") return;
        const existing = document.getElementById(PANEL_ID);
        if (existing) {
            existing.remove();
            return;
        }
        createPanel();
    });

    async function createPanel() {
        const saved = (await chrome.storage.local.get(POS_KEY))[POS_KEY] || {};

        const wrap = document.createElement("div");
        wrap.id = PANEL_ID;
        Object.assign(wrap.style, {
            position: "fixed",
            top: clamp(saved.top ?? 60, 0, window.innerHeight - 60) + "px",
            left: clamp(saved.left ?? window.innerWidth - 840, 8 - 760, window.innerWidth - 60) + "px",
            width: "min(802px, calc(100vw - 24px))",
            height: "min(646px, calc(100vh - 24px))",
            zIndex: "2147483646",
            display: "flex",
            flexDirection: "column",
            borderRadius: "12px",
            overflow: "hidden",
            border: "1px solid rgba(24, 36, 58, 0.16)",
            boxShadow: "0 24px 80px rgba(19, 30, 47, 0.3)",
            background: "#ece4d5",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        });

        // 顶部拖动条
        const bar = document.createElement("div");
        Object.assign(bar.style, {
            flex: "0 0 34px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "0 12px",
            cursor: "move",
            userSelect: "none",
            touchAction: "none",
            background: "linear-gradient(180deg, #1c2740, #131d30)",
            color: "rgba(236, 228, 213, 0.9)",
            fontSize: "12px",
            fontWeight: "600",
        });

        const title = document.createElement("span");
        title.textContent = "揽星 · 按住此栏拖动";
        bar.appendChild(title);

        const close = document.createElement("button");
        close.textContent = "×";
        close.title = "关闭浮窗";
        Object.assign(close.style, {
            marginLeft: "auto",
            border: "none",
            background: "transparent",
            color: "#fff",
            fontSize: "18px",
            lineHeight: "1",
            cursor: "pointer",
            padding: "2px 6px",
        });
        close.addEventListener("click", () => wrap.remove());
        bar.appendChild(close);

        // 面板主体：iframe + 拖动时的透明护罩（iframe 会吞掉指针事件）
        const body = document.createElement("div");
        Object.assign(body.style, { position: "relative", flex: "1", display: "flex" });

        const frame = document.createElement("iframe");
        frame.src = chrome.runtime.getURL("popup/index.html?view=float");
        Object.assign(frame.style, { border: "none", width: "100%", height: "100%", flex: "1" });

        const shield = document.createElement("div");
        Object.assign(shield.style, { position: "absolute", inset: "0", display: "none", zIndex: "1" });

        body.appendChild(frame);
        body.appendChild(shield);
        wrap.appendChild(bar);
        wrap.appendChild(body);
        document.documentElement.appendChild(wrap);

        // 拖动逻辑
        bar.addEventListener("pointerdown", (e) => {
            if (e.target === close) return;
            e.preventDefault();
            const startX = e.clientX;
            const startY = e.clientY;
            const rect = wrap.getBoundingClientRect();
            shield.style.display = "block";
            bar.setPointerCapture(e.pointerId);

            const onMove = (ev) => {
                wrap.style.left = clamp(rect.left + ev.clientX - startX, 8 - rect.width + 68, window.innerWidth - 68) + "px";
                wrap.style.top = clamp(rect.top + ev.clientY - startY, 0, window.innerHeight - 40) + "px";
            };
            const onUp = () => {
                shield.style.display = "none";
                bar.removeEventListener("pointermove", onMove);
                bar.removeEventListener("pointerup", onUp);
                chrome.storage.local.set({
                    [POS_KEY]: { left: parseInt(wrap.style.left, 10), top: parseInt(wrap.style.top, 10) },
                });
            };
            bar.addEventListener("pointermove", onMove);
            bar.addEventListener("pointerup", onUp);
        });
    }

    function clamp(v, min, max) {
        return Math.min(Math.max(v, min), max);
    }
})();
