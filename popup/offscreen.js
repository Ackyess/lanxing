// offscreen.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== "OFFSCREEN_CROP_REQUEST") return;

    const { dataUrl, rect } = msg.data;

    cropImage(dataUrl, rect)
        .then((res) => sendResponse({ success: true, imageData: res }))
        .catch((err) => sendResponse({ success: false, error: err.message }));

    return true;
});

async function cropImage(dataUrl, rect) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const dpr = rect.dpr || 1;

                const canvas = document.createElement("canvas");
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;

                const ctx = canvas.getContext("2d");

                ctx.drawImage(
                    img,
                    rect.x * dpr,
                    rect.y * dpr,
                    rect.width * dpr,
                    rect.height * dpr,
                    0,
                    0,
                    rect.width * dpr,
                    rect.height * dpr
                );

                resolve(canvas.toDataURL("image/png"));
            } catch (e) {
                reject(e);
            }
        };

        img.onerror = () => reject(new Error("offscreen 加载截图失败"));
        img.src = dataUrl;
    });
}
