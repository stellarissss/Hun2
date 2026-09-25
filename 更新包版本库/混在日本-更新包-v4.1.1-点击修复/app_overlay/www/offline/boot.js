/*!
 * ============================================================================
 * 离线引导 · boot.js
 * ============================================================================
 * 职责：在页面内联脚本定义完路径函数之后、hun_min.js 加载之前，
 *      强制把资源路径指向本地目录，并跳过版本探测的远程请求。
 *
 * 注意：本脚本在 <body> 开头加载，晚于 <head> 中的路径覆写占位脚本、
 *      早于 game_main.html 内联脚本的执行。因此采用「轮询应用」策略：
 *      内联脚本一完成定义，立即覆写。
 * ============================================================================
 */
(function (global) {
    'use strict';

    var applied = false;

    // ============================ 本地 COS 存根 ============================
    /**
     * 原版页面与游戏核心通过腾讯云 COS SDK 读写存档。
     * 单机版必须尽早提供同名构造器，否则 new COS({...}) 会抛错。
     * 这里在最早的时机（boot.js 位于 <body> 开头）安装。
     */
    function installCosShim() {
        if (global.COS && global.COS.__offline) return;
        function LocalCOS() {
            this.putObject = function (opts, cb) {
                try {
                    if (opts && typeof opts.Body === 'string' && global.HUN_PC &&
                        global.HUN_PC.SaveEngine) {
                        global.HUN_PC.SaveEngine.save(JSON.parse(opts.Body));
                    }
                } catch (e) { }
                if (cb) setTimeout(function () { cb(null, { Body: '' }); }, 0);
            };
            this.getObject = function (opts, cb) {
                var s = (global.HUN_PC && global.HUN_PC.SaveEngine)
                    ? global.HUN_PC.SaveEngine.load() : null;
                if (!s) { if (cb) cb({ statusCode: 404, error: 'Not Found' }, null); return; }
                if (cb) cb(null, { Body: JSON.stringify(s) });
            };
            this.deleteObject = function (opts, cb) { if (cb) cb(null, {}); };
        }
        LocalCOS.__offline = true;
        global.COS = LocalCOS;
        console.log('[离线引导] 本地 COS 存根已安装（早期）');
    }
    installCosShim();

    function applyOnce() {
        if (applied) return true;
        var ok = false;

        // ---- 1. 资源根路径 → 本地 ----
        if (typeof global.getResPath_CORS_Web === 'function') {
            global.getResPath_CORS_Web = function () { return '.'; };
            ok = true;
        }
        if (typeof global.getResPath_UNCORS_Web === 'function') {
            global.getResPath_UNCORS_Web = function () { return '.'; };
            ok = true;
        }
        if (typeof global.getResPath_By_CDN === 'function') {
            global.getResPath_By_CDN = function () { return '.'; };
            ok = true;
        }

        // ---- 2. 版本信息 → 本地文件（不再请求远程）----
        if (typeof global.getVersionInfo === 'function') {
            global.getVersionInfo = function () { return 'json/version.json'; };
            ok = true;
        }

        // ---- 3. 强制非开发环境（保证走生产分支，但路径已被上面覆盖）----
        if (typeof global.hasGameEnv_Dev === 'function') {
            global.hasGameEnv_Dev = function () { return false; };
            ok = true;
        }

        // ---- 4. 环境标识：PC 渠道（自动启用 HD 图集）----
        if (!global.channel) {
            try { global.channel = 'pc'; } catch (e) { }
        }

        // ---- 5. 画布分辨率倍率固定为 1（PC 专用修正）----
        // 原版 getDefault_CanvasScale() 返回 devicePixelRatio。在 HiDPI 屏
        // （dpr=1.5/2）上会导致：
        //   · 画布物理尺寸翻倍，显存与填充开销成倍增长；
        //   · getScreenWidth() 返回物理像素，而鼠标事件的 clientX 是 CSS 像素，
        //     两者相差 dpr 倍 → 拖曳/点击坐标整体偏移、超速。
        // PC 端不需要 HiDPI 超采样，固定为 1 可同时解决性能与坐标一致性。
        applyCanvasScaleFix();

        if (ok) {
            applied = true;
            console.log('[离线引导] 资源路径已本地化');
        }
        return applied;
    }

    /**
     * 把 CANVAS_SCALE 钉死为 1。
     * hun_min.js 以经典脚本（非模块、非 IIFE）方式加载，其顶层
     * `var CANVAS_SCALE` 即 window.CANVAS_SCALE，故可从外部覆写。
     * 同时覆写 getDefault_CanvasScale，保证 initCanvasScale() 重新计算时
     * 依然返回 1。
     *
     * 由于 BaseManager 在 hun_min.js 载入后才存在，本函数自带轮询重试，
     * 直到覆写成功为止（上限约 20s，足够覆盖资源加载耗时）。
     */
    function applyCanvasScaleFix() {
        try { global.CANVAS_SCALE = 1; } catch (e) { }

        var BM = global.BaseManager;
        if (BM && BM.prototype && typeof BM.prototype.getDefault_CanvasScale === 'function') {
            if (BM.prototype.__pcScaleFixed) return true;
            BM.prototype.getDefault_CanvasScale = function () { return 1; };
            BM.prototype.__pcScaleFixed = true;
            console.log('[离线引导] 画布分辨率倍率已固定为 1');
            return true;
        }
        // 未就绪 → 稍后重试
        if (!global.__pcScaleFixPending) {
            global.__pcScaleFixPending = true;
            var n = 0;
            var t = setInterval(function () {
                if (applyCanvasScaleFix() || ++n > 800) {   // 800 × 25ms = 20s
                    clearInterval(t);
                    global.__pcScaleFixPending = false;
                }
            }, 25);
        }
        return false;
    }
    global.__offlineApplyCanvasScaleFix = applyCanvasScaleFix;

    // 立即尝试；未就绪则轮询（页面内联脚本同步执行，通常几十毫秒内完成）
    if (!applyOnce()) {
        var n = 0;
        var t = setInterval(function () {
            if (applyOnce() || ++n > 300) clearInterval(t);
        }, 10);
    }

    // 暴露给 start.js
    global.__offlineApplyPaths = applyOnce;
})(window);
