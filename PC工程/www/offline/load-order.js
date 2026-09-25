/*!
 * ============================================================================
 * 离线适配层 · 资源加载时序桥 · load-order.js
 * ============================================================================
 * 【为什么需要这个文件】
 *
 * 原版运行在 http(s) 环境，资源加载时序是：
 *   gamedata.json / audio_unity.json 的 AJAX 回调
 *     ——与—— 图片 onload 回调
 *   二者竞争，通常 AJAX 先完成（同源小文件 + 服务端快），
 *   因此 audioEffect / gameData 在 loadResAllComplete() 触发前已就绪。
 *
 * 单机版运行在 file:// 环境，图片直接从磁盘解码（极快），
 * 而 JSON 读取要走 XHR，反而可能落后 —— 导致
 *   loadResCompleteArray 先记满 14 项 → 触发 loadResAllComplete()
 *   → loadHun2Effect() 里 this.audioEffect 仍为 undefined → 抛错
 *   → loadResAllComplete() 后续代码（PlayManager.init 等）全部被跳过
 *   → playManager.goodsManager 不存在 → 菜单期日抽奖 openShowMe 崩
 *   → 整个初始化链断掉，游戏卡在菜单。
 *
 * 【修复策略（不修改 hun_min.js 一个字节）】
 *   在 hun_min.js 执行前，预先用同步 XHR 把 JSON 读入内存；
 *   并包一层 LoadResManager.loadHun2Effect / MainManager.loadResAllComplete，
 *   保证：
 *     ① audioEffect 未就绪时，用预载数据兜底注入；
 *     ② loadResAllComplete 可重入（多次调用不重复 init）；
 *     ③ 单次异常不阻断后续初始化（在 try 内执行，逐段容错）。
 *
 * 该文件必须在 hun_min.js 之前加载（与 offline.js 同批）。
 * ============================================================================
 */
(function (global) {
    'use strict';

    var APP = global.HUN_PC || (global.HUN_PC = {});
    var installed = false;

    function log() {
        console.log.apply(console, ['[加载时序桥]'].concat([].slice.call(arguments)));
    }

    /**
     * 把载入数据注入 LoadResManager / AudioManager。
     * 若预载缓存里已有 audio_unity.json，则直接完成 setAudioUnityData 语义。
     */
    function injectAudioUnity(lrm) {
        if (!lrm) return false;
        if (lrm.audioEffect && lrm.audioEffect.length) return true;

        var cache = APP.jsonCache || {};
        var data = cache['json/audio_unity.json'];
        if (!data || !data.effect) return false;

        lrm.audioEffect = data.effect;
        try {
            var am = lrm.getMainManager && lrm.getMainManager().audioManager;
            if (am) {
                am.audioUnityData = data;
                if (typeof am.initVoiceMap === 'function') am.initVoiceMap();
            }
        } catch (e) { }
        return true;
    }

    /** 把 gamedata 注入 LoadResManager（原本由 AJAX success 完成） */
    function injectGameData(lrm) {
        if (!lrm) return false;
        if (lrm.gameData) return true;
        var cache = APP.jsonCache || {};
        var data = cache['json/gamedata.json'];
        if (!data) return false;
        lrm.gameData = data;
        return true;
    }

    function install() {
        if (installed) return true;
        var LRM = global.LoadResManager, MM = global.MainManager;
        if (!LRM || !LRM.prototype || !MM || !MM.prototype) return false;
        if (LRM.prototype.__hunLoadOrderPatched) { installed = true; return true; }

        // ---------- ① loadHun2Effect：数据兜底，永不抛错 ----------
        var origLoadEffect = LRM.prototype.loadHun2Effect;
        LRM.prototype.loadHun2Effect = function () {
            injectAudioUnity(this);
            if (!this.audioEffect || !this.audioEffect.length) {
                log('audioEffect 缺失，降级为空表（不影响可玩性）');
                this.audioEffect = [];
            }
            try {
                if (origLoadEffect) origLoadEffect.call(this);
            } catch (e) {
                console.warn('[加载时序桥] loadHun2Effect 原始实现异常，已忽略:', e);
                // 兜底自行建立映射
                try {
                    this.audioEffectMap = new global.HashMap();
                    for (var i = 0; i < this.audioEffect.length; i++) {
                        var c = this.audioEffect[i];
                        this.audioEffectMap.put(c.ids[0], c);
                    }
                } catch (e2) { }
            }
        };

        // ---------- ② loadResAllComplete：可重入 + 逐段容错 ----------
        var origAllComplete = MM.prototype.loadResAllComplete;
        MM.prototype.loadResAllComplete = function () {
            // 初始化只做一次；后续重复调用直接返回
            if (this.__hunInitDone) return;
            this.__hunInitDone = true;

            // 关键：确保数据先于初始化注入
            var lrm = this.loadResManager;
            injectAudioUnity(lrm);
            injectGameData(lrm);

            var self = this;
            var steps = [
                function () { lrm.loadHun2Effect(); },
                function () { lrm.loadBGM_City(); },
                function () { lrm.loadBGM_Job(); },
                function () { lrm.loadBGM_Job_Fight(); },
                function () { lrm.loadBGM_Job_Race(); }
            ];

            for (var i = 0; i < steps.length; i++) {
                try {
                    steps[i]();
                } catch (e) {
                    console.warn('[加载时序桥] 载入阶段 ' + i + ' 异常，继续执行:', e);
                }
            }

            try {
                if (origAllComplete) origAllComplete.call(this);
            } catch (e) {
                console.error('[加载时序桥] loadResAllComplete 异常:', e);
            }
        };

        LRM.prototype.__hunLoadOrderPatched = true;
        installed = true;
        log('载入时序桥已安装');
        return true;
    }

    // 轮询等待类定义（在这些脚本之后才由 hun_min.js 定义）
    var n = 0;
    var t = setInterval(function () {
        if (install() || ++n > 2000) clearInterval(t);
    }, 5);

    global.__hunInstallLoadOrder = install;
})(window);
