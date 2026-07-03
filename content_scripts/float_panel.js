// 揽星 页内浮窗：可拖动 + 可缩放的 iframe 容器（仅注入顶层页面）
(function () {
    if (window.top !== window) return;

    const PANEL_ID = "lanxing-float-panel";
    const POS_KEY = "lanxing_float_pos";
    const MIN_W = 360, MIN_H = 420;

    chrome.runtime.onMessage.addListener((msg) => {
        if ((msg.type || msg.action) !== "LANXING_TOGGLE_FLOAT_PANEL") return;
        const existing = document.getElementById(PANEL_ID);
        if (existing) { existing.remove(); return; }
        createPanel();
    });

    async function createPanel() {
        const saved = (await chrome.storage.local.get(POS_KEY))[POS_KEY] || {};

        const defW = Math.min(802, window.innerWidth - 24);
        const defH = Math.min(646, window.innerHeight - 24);
        const width  = clamp(saved.width  ?? defW, MIN_W, window.innerWidth - 16);
        const height = clamp(saved.height ?? defH, MIN_H, window.innerHeight - 16);
        const left = clamp(saved.left ?? (window.innerWidth - width - 24), 0, window.innerWidth - 60);
        const top  = clamp(saved.top  ?? 60, 0, window.innerHeight - 60);

        // 外层：overflow visible，承载缩放手柄；尺寸由它持有
        const wrap = document.createElement("div");
        wrap.id = PANEL_ID;
        Object.assign(wrap.style, {
            position: "fixed",
            left: left + "px", top: top + "px",
            width: width + "px", height: height + "px",
            zIndex: "2147483646",
            overflow: "visible",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        });

        // 圆角外壳：裁剪 iframe 直角、承载边框/阴影
        const shell = document.createElement("div");
        Object.assign(shell.style, {
            position: "absolute", inset: "0",
            display: "flex", flexDirection: "column",
            borderRadius: "12px", overflow: "hidden",
            border: "1px solid rgba(24, 36, 58, 0.16)",
            boxShadow: "0 24px 80px rgba(19, 30, 47, 0.3)",
            background: "#ece4d5",
        });

        // 顶部拖动条
        const bar = document.createElement("div");
        Object.assign(bar.style, {
            flex: "0 0 34px", display: "flex", alignItems: "center", gap: "8px",
            padding: "0 12px", cursor: "move", userSelect: "none", touchAction: "none",
            background: "linear-gradient(180deg, #1c2740, #131d30)",
            color: "rgba(236, 228, 213, 0.9)", fontSize: "12px", fontWeight: "600",
        });
        const title = document.createElement("span");
        title.textContent = "揽星 · 拖标题移动，拖边缘缩放";
        bar.appendChild(title);
        const close = document.createElement("button");
        close.textContent = "×"; close.title = "关闭浮窗";
        Object.assign(close.style, {
            marginLeft: "auto", border: "none", background: "transparent",
            color: "#fff", fontSize: "18px", lineHeight: "1", cursor: "pointer", padding: "2px 6px",
        });
        close.addEventListener("click", () => wrap.remove());
        bar.appendChild(close);

        // 主体：iframe + 拖动时的透明护罩（iframe 会吞掉指针事件）
        const body = document.createElement("div");
        Object.assign(body.style, { position: "relative", flex: "1", display: "flex" });
        const frame = document.createElement("iframe");
        frame.src = chrome.runtime.getURL("popup/index.html?view=float");
        Object.assign(frame.style, { border: "none", width: "100%", height: "100%", flex: "1" });
        const shield = document.createElement("div");
        Object.assign(shield.style, { position: "absolute", inset: "0", display: "none", zIndex: "1" });
        body.appendChild(frame); body.appendChild(shield);

        shell.appendChild(bar); shell.appendChild(body);
        wrap.appendChild(shell);
        document.documentElement.appendChild(wrap);

        function persist() {
            chrome.storage.local.set({ [POS_KEY]: {
                left: parseInt(wrap.style.left, 10), top: parseInt(wrap.style.top, 10),
                width: parseInt(wrap.style.width, 10), height: parseInt(wrap.style.height, 10),
            }});
        }

        // 移动（拖标题栏）
        bar.addEventListener("pointerdown", (e) => {
            if (e.target === close) return;
            e.preventDefault();
            const sx = e.clientX, sy = e.clientY;
            const r = wrap.getBoundingClientRect();
            shield.style.display = "block";
            bar.setPointerCapture(e.pointerId);
            const onMove = (ev) => {
                wrap.style.left = clamp(r.left + ev.clientX - sx, 8 - r.width + 68, window.innerWidth - 68) + "px";
                wrap.style.top  = clamp(r.top + ev.clientY - sy, 0, window.innerHeight - 40) + "px";
            };
            const onUp = () => {
                shield.style.display = "none";
                bar.removeEventListener("pointermove", onMove);
                bar.removeEventListener("pointerup", onUp);
                persist();
            };
            bar.addEventListener("pointermove", onMove);
            bar.addEventListener("pointerup", onUp);
        });

        addResizeHandles(wrap, shield, persist);
    }

    // 八向边缘/角缩放手柄（挂在 overflow:visible 的 wrap 上，不被圆角外壳裁掉）
    function addResizeHandles(wrap, shield, persist) {
        const HANDLES = [
            { n: "n",  cur: "ns-resize",   css: { top: "-3px", left: "12px", right: "12px", height: "7px" } },
            { n: "s",  cur: "ns-resize",   css: { bottom: "-3px", left: "12px", right: "12px", height: "7px" } },
            { n: "e",  cur: "ew-resize",   css: { top: "12px", bottom: "12px", right: "-3px", width: "7px" } },
            { n: "w",  cur: "ew-resize",   css: { top: "12px", bottom: "12px", left: "-3px", width: "7px" } },
            { n: "ne", cur: "nesw-resize", css: { top: "-4px", right: "-4px", width: "14px", height: "14px" } },
            { n: "nw", cur: "nwse-resize", css: { top: "-4px", left: "-4px", width: "14px", height: "14px" } },
            { n: "se", cur: "nwse-resize", css: { bottom: "-4px", right: "-4px", width: "14px", height: "14px" } },
            { n: "sw", cur: "nesw-resize", css: { bottom: "-4px", left: "-4px", width: "14px", height: "14px" } },
        ];
        for (const h of HANDLES) {
            const el = document.createElement("div");
            Object.assign(el.style, { position: "absolute", zIndex: "3", cursor: h.cur, touchAction: "none", ...h.css });
            el.addEventListener("pointerdown", (e) => {
                e.preventDefault(); e.stopPropagation();
                const sx = e.clientX, sy = e.clientY;
                const r = wrap.getBoundingClientRect();
                const R = r.left + r.width, B = r.top + r.height;
                shield.style.display = "block";
                el.setPointerCapture(e.pointerId);
                const onMove = (ev) => {
                    const dx = ev.clientX - sx, dy = ev.clientY - sy;
                    let left = r.left, top = r.top, width = r.width, height = r.height;
                    if (h.n.includes("e")) width  = clamp(r.width + dx,  MIN_W, window.innerWidth - 8 - r.left);
                    if (h.n.includes("w")) { width = clamp(r.width - dx, MIN_W, R - 8); left = R - width; }
                    if (h.n.includes("s")) height = clamp(r.height + dy, MIN_H, window.innerHeight - 8 - r.top);
                    if (h.n.includes("n")) { height = clamp(r.height - dy, MIN_H, B - 8); top = B - height; }
                    Object.assign(wrap.style, { left: left + "px", top: top + "px", width: width + "px", height: height + "px" });
                };
                const onUp = () => {
                    shield.style.display = "none";
                    el.removeEventListener("pointermove", onMove);
                    el.removeEventListener("pointerup", onUp);
                    persist();
                };
                el.addEventListener("pointermove", onMove);
                el.addEventListener("pointerup", onUp);
            });
            wrap.appendChild(el);
        }
    }

    function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
})();
