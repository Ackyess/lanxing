// 首屏前根据 URL 参数标记当前视图（popup / side / float），供 CSS 适配布局
(function () {
    const view = new URLSearchParams(location.search).get("view") || "popup";
    document.documentElement.classList.add("view-" + view);
})();
