/*!
 * PC 外壳启动脚本：负责引导游戏 iframe、管理启动遮罩与进度。
 */
(function () {
    'use strict';

    var boot = document.getElementById('boot');
    var bar = document.getElementById('bootbar');
    var tip = document.getElementById('boottip');
    var game = document.getElementById('game');

    var pct = 0;
    function setProgress(p, text) {
        pct = Math.max(pct, Math.min(100, p));
        if (bar) bar.style.width = pct + '%';
        if (text && tip) tip.textContent = text;
    }

    setProgress(8, '正在载入游戏资源…');

    // 游戏页就绪后淡出遮罩
    window.addEventListener('message', function (e) {
        var d = e.data;
        if (typeof d === 'string') {
            try { d = JSON.parse(d); } catch (err) { return; }
        }
        if (d && d.cmd === 'game-ready') {
            setProgress(100, '准备完成');
            setTimeout(function () {
                if (boot) boot.classList.add('hide');
                setTimeout(function () { if (boot) boot.style.display = 'none'; }, 700);
            }, 220);
        } else if (d && d.cmd === 'loading') {
            setProgress(d.percent || pct, d.text || '正在载入游戏资源…');
        } else if (d && d.cmd === 'error') {
            setProgress(100, '载入失败：' + (d.text || '未知错误'));
            if (boot) boot.classList.remove('hide');
        }
    });

    game.addEventListener('load', function () {
        setProgress(60, '正在初始化游戏…');
    });

    setProgress(20);

    // 兜底：8 秒后无论如何收起遮罩，避免卡死
    setTimeout(function () {
        if (boot && !boot.classList.contains('hide')) {
            setProgress(100, '');
            boot.classList.add('hide');
            setTimeout(function () { boot.style.display = 'none'; }, 700);
        }
    }, 8000);

    // 禁用右键与拖拽，贴近原生体验
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('dragstart', function (e) { e.preventDefault(); });
})();
