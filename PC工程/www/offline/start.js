/*!
 * ============================================================================
 * 离线引导 · start.js
 * ============================================================================
 * 职责：替换原页面的「远程注册 + 远程载入进度」启动链路，
 *      改为「本地建档 + 本地读档 + 直接初始化游戏」。
 *
 * 原链路：startLoadGameWithVersion()
 *           → $.ajax(version.json)        ← 改为本地文件
 *           → loadDependentJS()
 *           → LAB 载入 cn.js + hun_min.js
 *           → loadJsFinish() → requestUserInfo()
 *           → $.ajax(/h2/loadProgress.do)  ← 已被 offline.js 拦截为本地
 *           → COS 读存档                    ← 改为 localStorage
 *           → initGame()
 *
 * 本脚本在页面末尾加载，负责接管这一链路。
 * ============================================================================
 */
(function (global) {
    'use strict';

    var APP = global.HUN_PC;
    var tries = 0;

    function reportLoading(percent, text) {
        try {
            if (global.parent && global.parent !== global) {
                global.parent.postMessage(JSON.stringify({
                    cmd: 'loading', percent: percent, text: text
                }), '*');
            }
        } catch (e) { }
    }

    function reportReady() {
        try {
            if (global.parent && global.parent !== global) {
                global.parent.postMessage(JSON.stringify({ cmd: 'game-ready' }), '*');
            }
        } catch (e) { }
    }

    /** 覆写启动入口 */
    function install() {
        if (!global.$ || typeof global.startLoadGameWithVersion !== 'function') {
            return false;
        }

        reportLoading(30, '正在读取本地数据…');

        // ---- 【关键】initGame 幂等化 ----
        // 原版 initGame() 会 `new MainManager(); mainManager.init();`，
        // 而其内部的 loadResAllComplete() 会把 imgPerson/imgCar/imgGoods
        // 三张精灵图集切片后置为 null（原版的内存优化，属正常行为）。
        // 一旦 initGame 被重复调用，第二次构造 CarManager/ActorManager 时
        // 这些图集已是 null → drawImage 抛错 → 初始化链断裂。
        // 因此这里把它包成「只执行一次」，重复调用直接复用已有实例。
        if (typeof global.initGame === 'function' && !global.__hunInitGameGuarded) {
            var _origInitGame = global.initGame;
            var _initDone = false;
            global.initGame = function () {
                if (_initDone) return;
                _initDone = true;
                try {
                    return _origInitGame.apply(this, arguments);
                } catch (e) {
                    // 允许失败后重试（例如极端时序问题）
                    _initDone = false;
                    throw e;
                }
            };
            global.__hunInitGameGuarded = true;
        }

        // ---- 版本信息：直接使用本地常量，跳过远程请求 ----
        global.startLoadGameWithVersion = function () {
            try {
                global.gameVersion = global.gameVersion || '39396';
                if (typeof global.loadDependentJS === 'function') {
                    reportLoading(45, '正在载入游戏核心…');
                    global.loadDependentJS();
                } else {
                    console.error('[离线引导] loadDependentJS 不存在');
                }
            } catch (e) {
                console.error('[离线引导] 启动异常:', e);
                reportLoading(100, '启动失败');
            }
        };

        // ---- JS 依赖载入完成 → 直接初始化（跳过远程用户信息请求）----
        var _finishDone = false;
        global.loadJsFinish = function () {
            if (_finishDone) return;      // 防止 LAB 回调重复触发
            _finishDone = true;
            reportLoading(80, '正在初始化…');
            try {
                // 离线模式下 openid / userBaseInfo 由本地适配层提供
                if (typeof global.requestUserInfo === 'function') {
                    // 仍走 requestUserInfo，但其中的 AJAX 已被拦截为本地实现，
                    // 保证与原版代码路径完全一致（1:1 复刻）
                    global.requestUserInfo();
                } else if (typeof global.initGame === 'function') {
                    global.initGame();
                }
            } catch (e) {
                console.error('[离线引导] 初始化异常:', e);
            }
        };

        // ---- 存档读取：本地 localStorage 替代腾讯云 COS ----
        // 注意：原版 requestUserProgress() 内部创建 qloudCos 实例；
        // 游戏后续（如 checkDayLottery / 抽奖 / 换版本）会直接使用全局
        // qloudCos，因此这里必须先确保 qloudCos 存在且指向本地实现。
        if (typeof global.requestUserProgress === 'function' || true) {
            global.requestUserProgress = function () {
                // 1) 建立本地 COS 实例（后续所有存档读写都走它）
                ensureQloudCos();

                // 2) 读取本地存档（原始串 → 解压 → 解析）
                var saved = null;
                try { saved = global.__offlineParseSave(); } catch (e) { saved = null; }

                // 3) 还原用户信息 / 进度
                //    原版此处由服务端返回 userBaseInfo.progressObject，
                //    本地版直接从存档还原，供主菜单判定「有无存档」。
                try {
                    if (!global.userBaseInfo) global.userBaseInfo = {};

                    // 混币初始值：原版由服务端 userBaseInfo.hun_coin 下发，
                    // 离线版取本地配置（默认 20000，见 APP.config.INIT_HUN_COIN）。
                    // 注意：checkStartGame_has_LoadGame() 会执行
                    //   setHunCoin(userBaseInfo.hun_coin)
                    // 因此这里必须补齐，否则混币为 undefined。
                    var cfgCoin = (APP && APP.config && APP.config.INIT_HUN_COIN);
                    if (cfgCoin == null) cfgCoin = 20000;
                    if (global.userBaseInfo.hun_coin == null) {
                        global.userBaseInfo.hun_coin = cfgCoin;
                    }

                    global.userBaseInfo.progressObject = saved || null;
                    global.hasProgressLoadError = false;

                    if (saved && saved.globalParams && global.globalParamsPersistence) {
                        try { global.globalParamsPersistence.setProgressObj(saved.globalParams); } catch (e) { }
                    }
                    if (saved) {
                        console.log('[离线引导] 检测到本地存档，可继续游戏');
                    } else {
                        console.log('[离线引导] 未检测到本地存档，进入新游戏流程');
                    }
                } catch (e) {
                    console.error('[离线引导] 读档异常:', e);
                }

                if (typeof global.initGame === 'function') {
                    global.initGame();
                    setTimeout(reportReady, 300);
                }
            };
        }

        // ---- 存档写入：本地 localStorage 替代腾讯云 COS ----
        installCosShim();
        installSaveHook();

        // ---- 模块裁剪：社团 / 内置小游戏 / 排行榜 / 内购 / 众筹 ----
        // module-cutter.js 在 </body> 处加载，晚于本文件，故此处轮询等待。
        installModuleCutter();

        // ---- 启动 ----
        setTimeout(function () {
            try {
                global.startLoadGameWithVersion();
            } catch (e) {
                console.error('[离线引导] 启动失败:', e);
            }
        }, 60);

        return true;
    }

    /**
     * 模块裁剪器装配。
     * module-cutter.js 位于 </body>，晚于 start.js 加载；这里轮询等待其出现，
     * 一旦就绪立即 install()。同时保留最长 15s 的等待上限，避免无限轮询。
     */
    function installModuleCutter() {
        if (global.__hunModuleCutterInstalled) return;

        var tries = 0;
        var t = setInterval(function () {
            var C = (global.HUN_PC && global.HUN_PC.ModuleCutter) || null;
            if (C && typeof C.install === 'function') {
                clearInterval(t);
                global.__hunModuleCutterInstalled = true;
                try {
                    C.install();
                } catch (e) {
                    console.error('[离线引导] 模块裁剪器安装失败:', e);
                }
                return;
            }
            if (++tries > 600) {   // 600 × 25ms = 15s
                clearInterval(t);
                console.warn('[离线引导] 模块裁剪器加载超时');
            }
        }, 25);
        return t;
    }
    global.__hunInstallModuleCutter = installModuleCutter;

    // ============================ 本地 COS 实例 ============================
    /**
     * 建立一个全局 qloudCos，接口与原版腾讯云 COS SDK 实例保持一致：
     *   getObject({Bucket, Region, Key, ...}, callback)
     *   putObject({Bucket, Region, Key, Body, ...}, callback)
     *   deleteObject({...}, callback)
     * 全部读写重定向到本地 localStorage，绝不发起网络请求。
     *
     * 【存储格式】原版把整个进度对象 JSON.stringify 后用 pako.gzip 压缩，
     * 再把压缩串作为 Body 上传（见 hun_min.js 的 saveProgress / zip_sh）。
     * 因此本地实现必须：
     *   · putObject : 原样保存压缩串（不加解析，避免破坏二进制 gzip 流）
     *   · getObject : 原样返回压缩串，交由游戏侧 unzip_sh 解压
     * 这样读写两侧的字节完全一致，才能与游戏自身的解压逻辑对接。
     *
     * 【键命名】沿用原版的完整 Key（形如 `pro/progress/{uid}.txt`），
     * 统一加 `hjo_kv_` 前缀落在 localStorage，读写同键，天然对齐。
     */
    var SAVE_KV_PREFIX = 'hjo_kv_';

    /**
     * 原生磁盘 KV（Electron 环境可用）。
     * 渲染进程通过 preload 暴露的 window.hunNative 调用主进程写盘，
     * 保证存档落在真实文件系统上（localStorage 在 file:// 下偶有落盘延迟/丢失）。
     * 非 Electron 环境自动降级：native 为 null，全部走 localStorage。
     */
    var nativeKV = {
        _api: function () {
            // preload 暴露形态可能不同，做兼容探测
            var n = global.hunNative;
            if (n && typeof n.saveKV === 'function') return n;
            return null;
        },
        available: function () { return !!this._api(); },
        save: function (key, value, cb) {
            var api = this._api();
            if (!api) { if (cb) cb(false); return; }
            try {
                var r = api.saveKV(key, value);
                if (r && typeof r.then === 'function') {
                    r.then(function () { if (cb) cb(true); }, function () { if (cb) cb(false); });
                } else { if (cb) cb(true); }
            } catch (e) { if (cb) cb(false); }
        },
        load: function (key, cb) {
            var api = this._api();
            if (!api) { cb(null); return; }
            try {
                var r = api.loadKV(key);
                if (r && typeof r.then === 'function') {
                    r.then(function (v) { cb(v == null ? null : v); }, function () { cb(null); });
                } else { cb(r == null ? null : r); }
            } catch (e) { cb(null); }
        },
        remove: function (key) {
            var api = this._api();
            if (!api || typeof api.deleteKV !== 'function') return;
            try { api.deleteKV(key); } catch (e) { }
        }
    };

    function ensureQloudCos() {
        if (global.qloudCos && global.qloudCos.__offline) return global.qloudCos;

        function lsKey(key) { return SAVE_KV_PREFIX + key; }

        function readRaw(key) {
            try { return global.localStorage.getItem(lsKey(key)); } catch (e) { return null; }
        }

        function writeRaw(key, body) {
            // 双写：localStorage（即时可用）+ 原生磁盘（可靠持久）
            var ok = false;
            try { global.localStorage.setItem(lsKey(key), body); ok = true; }
            catch (e) { console.error('[离线引导] 本地写入失败:', e); }
            if (nativeKV.available()) nativeKV.save(lsKey(key), body);
            return ok;
        }

        var inst = {
            __offline: true,

            /**
             * 上传对象。Body 可能是：
             *   · pako.gzip 产出的「二进制字符串」（主进度，含大量非 ASCII 字节）
             *   · 普通文本（其它小键，如 day_lottery 的 mark）
             * 一律按字符串原样落盘，不做任何解析或转码。
             */
            putObject: function (opts, cb) {
                var key = (opts && opts.Key) || '';
                var body = opts && opts.Body;
                try {
                    if (body == null) {
                        if (cb) setTimeout(function () { cb(null, {}); }, 0);
                        return;
                    }
                    if (typeof body !== 'string') body = String(body);
                    writeRaw(key, body);
                    if (key.indexOf('progress/') >= 0) {
                        console.log('[离线引导] 进度已存盘 →', lsKey(key), '(' + body.length + 'B)');
                    }
                } catch (e) {
                    console.error('[离线引导] 存档写入失败:', e);
                }
                if (cb) setTimeout(function () { cb(null, {}); }, 0);
            },

            /**
             * 下载对象。命中则回调 (null, {Body})，未命中回调 404 错误对象
             * ——与原版 COS SDK 的约定一致，游戏侧据此判定「有无存档」。
             */
            getObject: function (opts, cb) {
                var key = (opts && opts.Key) || '';
                try {
                    var v = readRaw(key);

                    // localStorage 未命中时，尝试从原生磁盘读回（并回填缓存）
                    if (v == null && nativeKV.available()) {
                        nativeKV.load(lsKey(key), function (nv) {
                            if (nv == null) {
                                if (cb) cb({ statusCode: 404, error: 'Not Found' }, null);
                            } else {
                                try { global.localStorage.setItem(lsKey(key), nv); } catch (e) { }
                                if (cb) cb(null, { Body: nv });
                            }
                        });
                        return;
                    }

                    if (v == null) {
                        if (cb) setTimeout(function () {
                            cb({ statusCode: 404, error: 'Not Found' }, null);
                        }, 0);
                        return;
                    }
                    if (cb) setTimeout(function () { cb(null, { Body: v }); }, 0);
                } catch (e) {
                    if (cb) setTimeout(function () { cb(e, null); }, 0);
                }
            },

            deleteObject: function (opts, cb) {
                var key = (opts && opts.Key) || '';
                try { global.localStorage.removeItem(lsKey(key)); } catch (e) { }
                nativeKV.remove(lsKey(key));
                if (cb) setTimeout(function () { cb(null, {}); }, 0);
            }
        };

        global.qloudCos = inst;
        console.log('[离线引导] 全局 qloudCos 已指向本地存档实现');
        return inst;
    }
    global.__offlineEnsureQloudCos = ensureQloudCos;

    /** 供外部（requestUserProgress / 主菜单）读取原始存档串 */
    global.__offlineReadSaveRaw = function () {
        try {
            var uid = (global.userBaseInfo && global.userBaseInfo.id) || 'local_player';
            var key = SAVE_KV_PREFIX + 'pro/progress/' + uid + '.txt';
            var raw = global.localStorage.getItem(key);
            if (raw) return raw;
            // 兜底：扫描任意 progress 键（前缀可能随版本变化）
            for (var i = 0; i < global.localStorage.length; i++) {
                var k = global.localStorage.key(i);
                if (k && k.indexOf(SAVE_KV_PREFIX) === 0 && k.indexOf('progress/') >= 0) {
                    return global.localStorage.getItem(k);
                }
            }
        } catch (e) { }
        return null;
    };

    /** 异步版：localStorage 未命中时回落到原生磁盘 */
    global.__offlineReadSaveRawAsync = function (cb) {
        var v = global.__offlineReadSaveRaw();
        if (v != null) { cb(v); return; }
        if (!nativeKV.available()) { cb(null); return; }
        var uid = (global.userBaseInfo && global.userBaseInfo.id) || 'local_player';
        nativeKV.load(SAVE_KV_PREFIX + 'pro/progress/' + uid + '.txt', function (nv) {
            if (nv != null) {
                try { global.localStorage.setItem(SAVE_KV_PREFIX + 'pro/progress/' + uid + '.txt', nv); } catch (e) { }
            }
            cb(nv);
        });
    };

    /** 解压 + 解析原始存档串 → 进度对象；失败返回 null */
    function parseSaveRaw(raw) {
        if (!raw) return null;
        try {
            var json = (typeof global.unzip_sh === 'function') ? global.unzip_sh(raw) : raw;
            return JSON.parse(json);
        } catch (e) {
            // 兼容：若本身已是明文 JSON
            try { return JSON.parse(raw); } catch (e2) { return null; }
        }
    }
    global.__offlineParseSaveString = parseSaveRaw;

    global.__offlineParseSave = function () {
        return parseSaveRaw(global.__offlineReadSaveRaw());
    };

    /** 异步版：可用于启动期从原生磁盘恢复存档 */
    global.__offlineParseSaveAsync = function (cb) {
        global.__offlineReadSaveRawAsync(function (raw) { cb(parseSaveRaw(raw)); });
    };
    global.__offlineEnsureQloudCos = ensureQloudCos;

    // ============================ 存档适配 ============================
    /**
     * 原版使用腾讯云 COS SDK（COS 构造器）读写存档。
     * 单机版完全不需要云端，这里提供一个本地实现替换之，
     * 使 requestUserProgress() 里的 new COS({...}) 不再报错。
     */
    function installCosShim() {
        if (global.COS && global.COS.__offline) return;
        var saved = APP && APP.SaveEngine ? APP.SaveEngine.load() : null;

        function LocalCOS() {
            // 对应 COS 的 putObject
            this.putObject = function (opts, cb) {
                try {
                    if (opts && typeof opts.Body === 'string') {
                        var obj = JSON.parse(opts.Body);
                        APP.SaveEngine.save(obj);
                    }
                } catch (e) {
                    console.error('[离线引导] 存档解析失败:', e);
                }
                if (cb) setTimeout(function () { cb(null, { Body: '' }); }, 0);
            };
            // 对应 COS 的 getObject
            this.getObject = function (opts, cb) {
                var s = APP.SaveEngine.load();
                if (!s) { cb({ statusCode: 404, error: 'Not Found' }, null); return; }
                cb(null, { Body: JSON.stringify(s) });
            };
            this.deleteObject = function (opts, cb) { if (cb) cb(null, {}); };
        }
        LocalCOS.__offline = true;
        global.COS = LocalCOS;
        console.log('[离线引导] 本地 COS 存根已安装');
    }

    /** 把游戏的存档调用重定向到本地 localStorage */
    function installSaveHook() {
        if (!APP || !APP.SaveEngine) return;

        // 若全局尚无 qloudCos，立即建立本地实现
        if (!global.qloudCos || !global.qloudCos.__offline) {
            ensureQloudCos();
        }

        // 轮询兜底：防止后续代码用 new COS() 覆盖掉本地实例
        var t = setInterval(function () {
            var cos = global.qloudCos;
            if (!cos || cos.__offline) { clearInterval(t); return; }
            ensureQloudCos();
            clearInterval(t);
        }, 60);

        setTimeout(function () { clearInterval(t); }, 15000);
    }

    // 等待页面脚本就绪
    var timer = setInterval(function () {
        if (install() || ++tries > 400) {
            clearInterval(timer);
            if (tries > 400) console.error('[离线引导] 等待页面脚本超时');
        }
    }, 25);

})(window);
