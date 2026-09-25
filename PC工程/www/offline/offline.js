/*!
 * ============================================================================
 *  《混在日本》PC 单机版 · 离线适配层
 * ============================================================================
 *  设计原则
 *  1. 不修改 hun_min.js —— 通过猴补丁（monkey-patch）在运行时接管网络层，
 *     保证游戏核心与云端版逐字节一致，实现「原子化一比一复刻」。
 *  2. 全部逻辑本地实现 —— 断网可玩，无任何外部请求。
 *  3. 模块裁剪在 UI 层与调用层双保险 —— 入口隐藏 + 调用兜底，绝不崩溃。
 *  4. 预留扩展点 —— 内购系统以 Provider 插件形式预留，后续接入渠道即可商用。
 *
 *  加载顺序（必须在 hun_min.js 之前、jQuery 之后）：
 *      jquery.min.js → offline/offline.js → ... → hun_min.js
 * ============================================================================
 */
(function (global) {
    'use strict';

    // ========================== 常量与配置 ==========================
    var APP = global.HUN_PC || (global.HUN_PC = {});

    APP.version = '1.0.0';
    APP.config = {
        // 初始混币（用户决策 D1：去掉内购，混币初始 20000）
        INIT_HUN_COIN: 20000,
        // 初始现金（沿用原版 newGameMoney = 3000）
        INIT_CASH: 3000,
        // 存档键名与版本
        SAVE_KEY: 'hjo_save_v1',
        SETTINGS_KEY: 'hjo_settings_v1',
        SAVE_VERSION: 1,
        // 被裁剪模块开关（用户决策 D2/D3）
        ENABLE_CLUB: false,        // 社团 / 艺伎 / 黑金
        ENABLE_INNER_GAME: false,  // 内置小游戏 / FC 游戏厅（D2：删除，且会引入外网图标）
        ENABLE_RANK: false,        // 排行榜
        ENABLE_CROWDFUND: false,   // 众筹 / 乞讨
        ENABLE_IAP: false,         // 内购（D1：暂删，预留框架）
        // 调试
        DEBUG: false
    };

    function log() {
        if (APP.config.DEBUG && global.console) {
            console.log.apply(console, ['[离线适配]'].concat([].slice.call(arguments)));
        }
    }

    // ========================== 1. 本地存档引擎 ==========================
    /**
     * 存档结构（与游戏 ProgressObject 序列化结果完全对齐）：
     * {
     *   GRoot: {...},            // gamedata Root 原始数据（只读规则库）
     *   player: {...},           // 玩家属性
     *   groupPlayer: {...},      // 车队（车辆/手下）
     *   citys: [...],            // 各城市状态
     *   missionManager: {...},   // 任务进度
     *   propertyManager: {...},  // 房产
     *   curCityTGs: [...],       // 当前城市交易货品
     *   cache: [...],            // 进度缓存
     *   params: {...},           // 参数（天数/关卡/所在城市）
     *   __meta: { version, savedAt, playtime }
     * }
     */
    var SaveEngine = {
        _key: function () { return APP.config.SAVE_KEY; },

        /** 是否存在存档 */
        has: function () {
            try {
                return !!global.localStorage.getItem(this._key());
            } catch (e) { return false; }
        },

        /** 读取存档（返回对象或 null） */
        load: function () {
            try {
                var raw = global.localStorage.getItem(this._key());
                if (!raw) return null;
                var obj = JSON.parse(raw);
                if (!obj || typeof obj !== 'object') return null;
                log('读档成功，存档版本', obj.__meta && obj.__meta.version);
                return obj;
            } catch (e) {
                console.error('[离线适配] 读档失败:', e);
                return null;
            }
        },

        /** 写入存档 */
        save: function (obj) {
            try {
                obj = obj || {};
                obj.__meta = obj.__meta || {};
                obj.__meta.version = APP.config.SAVE_VERSION;
                obj.__meta.savedAt = Date.now();
                var str = JSON.stringify(obj);
                global.localStorage.setItem(this._key(), str);
                log('存档成功，大小', (str.length / 1024).toFixed(1), 'KB');
                return true;
            } catch (e) {
                console.error('[离线适配] 存档失败:', e);
                return false;
            }
        },

        /** 删除存档 */
        clear: function () {
            try {
                global.localStorage.removeItem(this._key());
                log('存档已清除');
                return true;
            } catch (e) { return false; }
        },

        /** 存档元信息（供主菜单展示） */
        meta: function () {
            var o = this.load();
            if (!o || !o.__meta) return null;
            var m = o.__meta;
            var p = o.params || {};
            return {
                savedAt: m.savedAt,
                day: p.day,
                curCityId: p.curCityId,
                gameLevel: p.gameLevel,
                hunCoin: (o.player && o.player.hunCoin) || 0,
                cash: (o.player && o.player.cash) || 0
            };
        }
    };
    APP.SaveEngine = SaveEngine;

    // ========================== 2. 设置存储 ==========================
    var Settings = {
        _cache: null,
        defaults: {
            bgmVolume: 20,
            effectVolume: 100,
            enableBGM: true,
            enableEffect: true,
            fullscreen: false,
            language: 0   // LANGUAGE_ZH
        },
        all: function () {
            if (this._cache) return this._cache;
            var o = {};
            try {
                var raw = global.localStorage.getItem(APP.config.SETTINGS_KEY);
                o = raw ? JSON.parse(raw) : {};
            } catch (e) { o = {}; }
            for (var k in this.defaults) {
                if (!(k in o)) o[k] = this.defaults[k];
            }
            this._cache = o;
            return o;
        },
        get: function (k) { return this.all()[k]; },
        set: function (k, v) {
            var o = this.all();
            o[k] = v;
            this._cache = o;
            try {
                global.localStorage.setItem(APP.config.SETTINGS_KEY, JSON.stringify(o));
            } catch (e) { }
            return v;
        }
    };
    APP.Settings = Settings;

    // ========================== 3. 内购 Provider 框架（预留） ==========================
    /**
     * 内购系统以插件形式预留。当前 ENABLE_IAP = false，
     * 所有调用直接返回「不支持」，不会发起任何网络请求。
     * 后续接入渠道（如微信支付）时，实现 registerProvider() 即可，
     * 无需改动游戏核心代码。
     */
    var PaymentKit = {
        _provider: null,
        registerProvider: function (p) {
            this._provider = p;
            APP.config.ENABLE_IAP = true;
            log('已注册支付渠道:', p && p.name);
        },
        unregister: function () {
            this._provider = null;
            APP.config.ENABLE_IAP = false;
        },
        isAvailable: function () {
            return APP.config.ENABLE_IAP && !!this._provider && this._provider.isReady();
        },
        /** 发起购买；返回 Promise */
        purchase: function (productId) {
            if (!this.isAvailable()) {
                return Promise.reject(new Error('IAP_NOT_AVAILABLE'));
            }
            return this._provider.purchase(productId);
        },
        /** 查询未完成订单（用于恢复） */
        queryPending: function () {
            if (!this.isAvailable()) return Promise.resolve([]);
            return this._provider.queryPending();
        }
    };
    APP.PaymentKit = PaymentKit;

    // ========================== 4. 端点路由表 ==========================
    /**
     * 四大类处理：
     *   LOCAL  —— 本地实现，返回游戏所需的真实数据结构
     *   DELETE —— 已裁剪模块，返回「空成功」，同时 UI 层已隐藏入口
     *   SILENT —— 联网/风控/统计，静默成功，不产生副作用
     *   PAY    —— 内购，走 PaymentKit（当前未启用）
     */
    var Router = {
        /** 提取 URL 的路径部分（去掉域名、查询串） */
        pathOf: function (url) {
            if (!url) return '';
            var u = String(url);
            u = u.replace(/^https?:\/\/[^\/]+/i, '');
            u = u.split('#')[0].split('?')[0];
            return u;
        },

        /** 匹配端点名（后缀匹配，兼容带/不带前导斜杠） */
        nameOf: function (path) {
            var keys = Object.keys(Router.table);
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (path === k || path === k.replace(/^\//, '') ||
                    path.slice(-k.length) === k) {
                    return k;
                }
            }
            return null;
        },

        table: {
            /* ---------- 核心：本地实现 ---------- */
            '/h2/loadProgress.do': 'core_loadProgress',
            '/h2/saveProgress.do': 'core_saveProgress',
            '/h2/gameOver.do': 'core_gameOver',
            '/h2/getEvent.do': 'core_getEvent',
            '/h2/get_exparam_by_openid.do': 'core_exparam',
            '/h2/exePayData.do': 'core_exePayData',
            '/curTime.action': 'core_curTime',
            '/h2/login.do': 'silent_ok',
            '/loginqq.action': 'silent_ok',

            /* ---------- 混币与消费记录：本地记账 ---------- */
            '/h2/getHunCoinReward.do': 'core_hunCoinReward',
            '/h2/consume_huncoin_record.do': 'silent_ok',

            /* ---------- 风控/统计：静默 ---------- */
            '/h2/onlineselfprogress.do': 'silent_ok',
            '/h2/onlineprogress.do': 'silent_ok',
            '/h2/checkSensitiveKeyWords.do': 'silent_okPass',
            '/h2/qcloud_temp_credential.do': 'silent_empty',
            '/h2/qcloud_temp_credential_allopen_out.do': 'silent_empty',
            /* 埋点统计：StatManager.addPoint_Stat_SH 走裸 XMLHttpRequest，
               目标 https://hun1.hun333.com/stat/add_point.do（原版用于运营埋点）。
               单机版无需上报，本地直接吞掉。 */
            '/stat/add_point.do': 'silent_ok',

            /* ---------- D2 裁剪：社团 / 艺妓 / 黑金 / FC ---------- */
            '/h2club/getClubByInfo.do': 'cut_club',
            '/h2club/createClubOnly.do': 'cut_club',
            '/h2club/getClubArea.do': 'cut_club',
            '/h2club/createClubArea.do': 'cut_club',
            '/h2club/getClubAreaByInfo.do': 'cut_club',
            '/h2club/getRobList.do': 'cut_club',
            '/h2club/finishBattle.do': 'cut_club',
            '/h2club/finishBattle_Game.do': 'cut_club',
            '/h2club/updatePlayerClubData.do': 'cut_club',
            '/h2club/getMessageByOpenId_Type.do': 'cut_club',
            '/h2club/removeMessageByOpenId_Type.do': 'cut_club',

            /* ---------- D3 裁剪：排行榜 ---------- */
            '/h2/rankStuff.do': 'cut_rank',
            '/h2club/getClubAreaRanks.do': 'cut_rank',
            '/h2club/getClubAreaTotalRanks.do': 'cut_rank',

            /* ---------- 裁剪：众筹 / 乞讨 ---------- */
            '/h2/forMoney.do': 'cut_crowdfund',
            '/h2/crowdfund.do': 'cut_crowdfund',
            '/h2/crowdfundStuff.do': 'cut_crowdfund',

            /* ---------- D1 裁剪：内购（预留） ---------- */
            '/h2pay/wx_alipay_result.do': 'pay_gone',
            '/h2pay/wx_alipay_result_huncoin.do': 'pay_gone',
            '/h2pay/iap_result.do': 'pay_gone',
            '/apple_pay/iap_huncoin.do': 'pay_gone',
            '/h2pay/checkUnPayHunCoin.do': 'pay_gone',
            '/h2pay/wx_orderQuery.do': 'pay_gone',
            '/h2pay/ali_orderQuery.do': 'pay_gone',
            '/h2pay/pay_qq.do': 'pay_gone',
            '/h2pay/pay.do': 'pay_gone',
            '/h2pay/qq_user_comfirm.do': 'pay_gone',
            '/h2pay/wx_user_comfirm.do': 'pay_gone'
        },

        /* ===================== 处理器实现 ===================== */
        handlers: {
            silent_ok: function () {
                return { result: 'ok', code: 0 };
            },
            silent_okPass: function (d) {
                // 敏感词检测：本地一律放行
                return { result: 'ok', code: 0, hasSensitive: false, words: [] };
            },
            silent_empty: function () { return {}; },

            cut_club: function () {
                return { result: 'OK', code: 0, club: null, clubs: [], areas: [], list: [] };
            },
            cut_rank: function () {
                return { result: 'OK', code: 0, rankList: [], arr: [], list: [], total: 0 };
            },
            cut_crowdfund: function () {
                return { result: 'OK', code: 0, list: [], stuff: null, money: 0 };
            },
            pay_gone: function () {
                return { result: 'OK', code: -1, msg: 'IAP_NOT_AVAILABLE' };
            },

            core_curTime: function () {
                // 服务器时间 → 本地时间（原版用于防作弊，单机无需）
                return {
                    result: 'ok',
                    code: 0,
                    currentTimeMillis: Date.now(),
                    time: Date.now()
                };
            },

            /* 载入用户信息：启动链路第一环 */
            core_loadProgress: function (d) {
                var saved = SaveEngine.load();
                var uid = (d && d.uid) || 'local_player';
                var base = {
                    result: 'ok',
                    code: 0,
                    currentTimeMillis_server: Date.now(),
                    QCLOUD_BUCKET: '',
                    QCLOUD_REGION: '',
                    userBaseInfo: {
                        id: uid,
                        openid: (d && d.openid) || 'local_openid',
                        channel: (d && d.channel) || 'pc',
                        nickname: '',
                        hunCoin: APP.config.INIT_HUN_COIN,
                        // 存档内容以字符串形式回传，由游戏侧解压解析
                        progressObject: null
                    },
                    userProgress: 'NONE'
                };
                if (saved) {
                    try {
                        base.userProgress = JSON.stringify(saved);
                    } catch (e) {
                        base.userProgress = 'NONE';
                    }
                }
                log('loadProgress →', saved ? '有存档' : '新玩家');
                return base;
            },

            /* 保存进度 */
            core_saveProgress: function (d) {
                try {
                    if (d && typeof d.progress === 'string') {
                        SaveEngine.save(JSON.parse(d.progress));
                    }
                } catch (e) { }
                return { result: 'ok', code: 0 };
            },

            /* 结算上报：单机版直接返回 ok */
            core_gameOver: function () {
                return { result: 'ok', code: 0 };
            },

            /* 混币奖励：本地记账 */
            core_hunCoinReward: function (d) {
                return {
                    result: 'OK',
                    code: 0,
                    reward_hun_coin: (d && d.reward_hun_coin) || 0,
                    remain_hun_coin: (d && d.remain_hun_coin) || 0
                };
            },

            /* 扩展参数（5 星奖励配置） */
            core_exparam: function () {
                return { result: 'ok', code: 0, ex_params: '' };
            },

            core_exePayData: function () {
                return { result: 'ok', code: 0, hasPay: false, list: [] };
            },

            /* 随机事件：由本地事件引擎产出（见 EventEngine） */
            core_getEvent: function (d) {
                if (APP.EventEngine) {
                    return { event: APP.EventEngine.next(d) };
                }
                return { event: null };
            }
        },

        /** 统一分发 */
        dispatch: function (url, data) {
            var path = this.pathOf(url);
            var name = this.nameOf(path);
            if (!name) {
                log('未匹配端点，返回空成功:', path);
                return { result: 'ok', code: 0 };
            }
            var fn = this.handlers[this.table[name]];
            if (typeof fn !== 'function') {
                log('处理器缺失:', this.table[name]);
                return { result: 'ok', code: 0 };
            }
            var out = fn(data || {});
            log('拦截', name, '→', this.table[name]);
            return out;
        }
    };
    APP.Router = Router;

    // ========================== 5. 事件引擎（本地随机事件） ==========================
    /**
     * 原版 getEvent.do 由服务端下发事件。单机版改为本地事件池生成。
     * 事件结构（依据 getEvent.do 消费端字段）：
     *   { type:'interaction', title, story, audioKey, listYes:[...], listNo:[...] }
     * 每个选项：{ type, title, story, health, dao_value, cash, goodsid, ... }
     */
    var EventEngine = {
        _pool: [],
        _recent: [],
        MAX_RECENT: 6,

        /** 从 gamedata / 文案库中装载事件池 */
        init: function (gameData, words) {
            this._pool = [];
            this._words = words || {};
            this._gameData = gameData || {};
            log('事件引擎初始化，事件池', this._pool.length);
        },

        /** 取下一个事件（去重） */
        next: function () {
            if (!this._pool.length) return null;
            for (var i = 0; i < 10; i++) {
                var e = this._pool[Math.floor(Math.random() * this._pool.length)];
                if (this._recent.indexOf(e.title) < 0) {
                    this._recent.push(e.title);
                    if (this._recent.length > this.MAX_RECENT) this._recent.shift();
                    return e;
                }
            }
            return this._pool[0];
        }
    };
    APP.EventEngine = EventEngine;

    // ========================== 6. AJAX 猴补丁 ==========================
    /**
     * 本地 JSON 预载缓存。
     *
     * 背景：原版通过 $.ajax 异步加载 gamedata.json / audio_unity.json，
     * 而 loadResAllComplete() 的门控依赖 loadResComplete(id) 的调用次数。
     * 在 file:// 环境下，图片 onload 与 AJAX 回调的相对顺序与原版
     * （http 环境）不一致，会出现「图片已全部加载完 → 触发
     * loadResAllComplete() → 但 audioEffect 还没赋值」的竞态，
     * 导致 loadHun2Effect() 抛错、游戏卡在 SCENE_LOAD_RES。
     *
     * 解决：在 hun_min.js 执行前，用同步 XHR 把关键 JSON 读入内存缓存，
     * 使 $.ajax 能够「立即」回调（仍是异步语义，但数据已就绪），
     * 从而与图片加载顺序解耦。
     */
    var jsonCache = {};

    function syncPreload(url) {
        try {
            var x = new global.XMLHttpRequest();
            x.open('GET', url, false);   // 同步：仅用于本地小文件
            x.send(null);
            if (x.status === 200 || x.status === 0) {
                jsonCache[url] = JSON.parse(x.responseText);
                return true;
            }
        } catch (e) {
            console.warn('[离线适配] 预载失败:', url, e);
        }
        return false;
    }

    /** 预载启动必需的数据文件（相对 www/ 根目录） */
    function preloadGameData() {
        var files = [
            'json/audio_unity.json',
            'json/gamedata.json',
            'json/audio_effect_min.json',
            'json/version.json'
        ];
        var ok = 0;
        for (var i = 0; i < files.length; i++) {
            if (syncPreload(files[i])) ok++;
        }
        log('本地 JSON 预载完成: ' + ok + '/' + files.length);
        return ok;
    }
    APP.preloadGameData = preloadGameData;
    APP.jsonCache = jsonCache;

    function installAjaxPatch($) {
        if (!$ || !$.ajax || $.__hunPatched) return;
        $.__hunPatched = true;

        var nativeAjax = $.ajax;

        function fakeXHR(result, url) {
            return {
                status: 200,
                statusText: 'OK',
                readyState: 4,
                responseText: typeof result === 'string' ? result : JSON.stringify(result),
                responseJSON: result,
                getResponseHeader: function () { return 'application/json'; },
                abort: function () { },
                setRequestHeader: function () { }
            };
        }

        // 本地 JSON 读取：优先命中预载缓存（见 preloadGameData）
        function loadLocalJson(url, cb, errCb) {
            var clean = url.split('#')[0].split('?')[0];
            // 归一化：去掉前导 "./"
            var norm = clean.replace(/^\.\//, '');
            if (jsonCache[norm] !== undefined) {
                setTimeout(function () { cb(jsonCache[norm]); }, 0);
                return;
            }
            if (jsonCache[clean] !== undefined) {
                setTimeout(function () { cb(jsonCache[clean]); }, 0);
                return;
            }
            // 未预载 → 即时同步读取（本地小文件，代价可忽略）
            if (syncPreload(norm)) {
                setTimeout(function () { cb(jsonCache[norm]); }, 0);
                return;
            }
            // 最后兜底：异步 XHR
            try {
                var x = new global.XMLHttpRequest();
                x.open('GET', clean, true);
                x.onreadystatechange = function () {
                    if (x.readyState !== 4) return;
                    if (x.status === 200 || x.status === 0) {
                        try {
                            var j = JSON.parse(x.responseText);
                            jsonCache[norm] = j;
                            cb(j);
                            return;
                        } catch (e) { }
                    }
                    if (errCb) errCb(new Error('read failed: ' + clean));
                };
                x.send();
            } catch (e) {
                if (errCb) errCb(e);
            }
        }

        $.ajax = function (opts) {
            // 兼容 $.ajax(url, settings)
            if (typeof opts === 'string') opts = { url: opts };

            var url = (opts && opts.url) || '';
            var path = Router.pathOf(url);

            // ---- 本地 JSON：自行读取，绕过 Chrome file:// 的 XHR 限制 ----
            if (!/^(https?:)?\/\//i.test(url) && /\.json(\?|$)/i.test(url)) {
                loadLocalJson(url, function (j) {
                    try {
                        if (opts.success) opts.success(j, 'success', fakeXHR(j, url));
                        if (opts.complete) opts.complete(fakeXHR(j, url), 'success');
                    } catch (e) {
                        console.error('[离线适配] 本地 JSON 回调异常:', e);
                        if (opts.error) opts.error(fakeXHR({}, url), 'error', e);
                    }
                }, function (e) {
                    console.error('[离线适配] 本地 JSON 读取失败:', url, e);
                    if (opts.error) opts.error(fakeXHR({}, url), 'error', e);
                    if (opts.complete) opts.complete(fakeXHR({}, url), 'error');
                });
                return fakeXHR({}, url);
            }

            // 放行本地相对静态资源（js/css/pics/audio 等）
            if (!/^(https?:)?\/\//i.test(url) && !/\.(do|action|jsp)(\?|$)/i.test(path)) {
                return nativeAjax.apply($, arguments);
            }
            if (!Router.nameOf(path)) {
                log('拦截未知外网请求，返回空:', url);
                var empty = { result: 'ok', code: 0 };
                setTimeout(function () {
                    if (opts.success) opts.success(empty);
                    if (opts.complete) opts.complete(fakeXHR(empty, url), 'success');
                }, 0);
                return fakeXHR(empty, url);
            }

            var out = Router.dispatch(url, opts.data || {});
            setTimeout(function () {
                try {
                    var data = out;
                    if (opts.dataType === 'text') data = JSON.stringify(out);
                    if (opts.success) opts.success(data);
                    if (opts.complete) opts.complete(fakeXHR(out, url), 'success');
                } catch (e) {
                    console.error('[离线适配] 回调异常:', e);
                    if (opts.error) opts.error(fakeXHR({}, url), 'error', e);
                }
            }, 0);
            return fakeXHR(out, url);
        };

        // 派生方法
        $.get = function (url, data, success, dataType) {
            if (typeof data === 'function') { dataType = success; success = data; data = {}; }
            return $.ajax({ url: url, data: data, success: success, dataType: dataType, type: 'GET' });
        };
        $.post = function (url, data, success, dataType) {
            if (typeof data === 'function') { dataType = success; success = data; data = {}; }
            return $.ajax({ url: url, data: data, success: success, dataType: dataType, type: 'POST' });
        };
        $.getJSON = function (url, data, success) {
            if (typeof data === 'function') { success = data; data = {}; }
            return $.ajax({ url: url, data: data, success: success, dataType: 'json', type: 'GET' });
        };

        // 拦截原生 XHR / fetch / WebSocket，确保零外网
        var NativeXHR = global.XMLHttpRequest;
        global.XMLHttpRequest = function () {
            var x = new NativeXHR();
            var _open = x.open;
            var _send = x.send;
            var _blocked = false;

            x.open = function (m, u) {
                var p = Router.pathOf(u);
                // 命中路由表 → 本地派发（不发起真实网络请求）
                if (/^(https?:)?\/\//i.test(u) && Router.nameOf(p)) {
                    var out = Router.dispatch(u, {});
                    x.__offlineBody = JSON.stringify(out);
                    x.__offlineDone = true;
                    try {
                        Object.defineProperty(x, 'readyState', { value: 4, configurable: true });
                        Object.defineProperty(x, 'status', { value: 200, configurable: true });
                        Object.defineProperty(x, 'statusText', { value: 'OK', configurable: true });
                        Object.defineProperty(x, 'responseText', {
                            get: function () { return x.__offlineBody; }, configurable: true
                        });
                        Object.defineProperty(x, 'response', {
                            get: function () { return x.__offlineBody; }, configurable: true
                        });
                    } catch (e) { }
                    _blocked = true;
                    return;
                }
                // 未命中且为外网 → 彻底阻断
                if (/^(https?:)?\/\//i.test(u) && !isLocalAsset(u)) {
                    log('XHR 拦截外网:', u);
                    _blocked = true;
                    x.__offlineDone = true;
                    try {
                        Object.defineProperty(x, 'readyState', { value: 4, configurable: true });
                        Object.defineProperty(x, 'status', { value: 200, configurable: true });
                        Object.defineProperty(x, 'statusText', { value: 'OK', configurable: true });
                        Object.defineProperty(x, 'responseText', { value: '{"result":"ok","code":0}', configurable: true });
                        Object.defineProperty(x, 'response', { value: '{"result":"ok","code":0}', configurable: true });
                    } catch (e) { }
                    return;
                }
                return _open.apply(x, arguments);
            };

            x.send = function () {
                if (_blocked) {
                    // 触发只读回调，让调用方拿到"已完成"的假响应
                    setTimeout(function () {
                        try { if (x.onreadystatechange) x.onreadystatechange(); } catch (e) { }
                        try { if (x.onload) x.onload(); } catch (e) { }
                    }, 0);
                    return;
                }
                return _send.apply(x, arguments);
            };
            return x;
        };

        if (global.fetch) {
            var nativeFetch = global.fetch;
            global.fetch = function (input, init) {
                var u = typeof input === 'string' ? input : (input && input.url) || '';
                var p = Router.pathOf(u);
                if (/^https?:\/\//i.test(u) && !isLocalAsset(u)) {
                    log('fetch 拦截:', u);
                    var res = Router.dispatch(u, {});
                    return Promise.resolve(new Response(JSON.stringify(res), {
                        status: 200, headers: { 'Content-Type': 'application/json' }
                    }));
                }
                return nativeFetch.apply(global, arguments);
            };
        }

        // WebSocket 一律禁用（游戏不使用，防止残留连接）
        global.WebSocket = function () {
            throw new Error('OFFLINE_MODE: WebSocket disabled');
        };

        log('AJAX / XHR / fetch 猴补丁已安装');
    }

    /** 判断是否为本地资源（相对路径 / 同源静态文件） */
    function isLocalAsset(u) {
        if (!u) return false;
        if (/^(file|data|blob|about):/i.test(u)) return true;
        if (!/^(https?:)?\/\//i.test(u)) return true;   // 相对路径
        try {
            var abs = new URL(u, global.location.href);
            if (abs.origin === global.location.origin) return true;
        } catch (e) { }
        return false;
    }
    APP.isLocalAsset = isLocalAsset;

    // ========================== 7. 模块裁剪 ==========================
    /**
     * 在游戏初始化后，隐藏被裁剪模块的 UI 入口。
     * 由于入口按钮由游戏动态创建，这里采用「主动清理 + 定时守卫」双策略。
     */
    var ModuleCutter = {
        BLOCKED_STATES: [],

        init: function () {
            if (!APP.config.ENABLE_CLUB) {                this.BLOCKED_STATES.push('PM_STATE_CLUB', 'SMM_STATE_RANK');
            }
            if (!APP.config.ENABLE_RANK) {
                this.BLOCKED_STATES.push('SMM_STATE_RANK');
            }
            if (!APP.config.ENABLE_CROWDFUND) {
                this.BLOCKED_STATES.push('SMM_STATE_CROWDFUNDING');
            }
            log('需屏蔽的状态:', this.BLOCKED_STATES.join(', '));
        },

        /** 拦截状态切换 */
        installStateGuard: function () {
            if (!global.MainManager || !global.MainManager.prototype) return;
            var proto = global.MainManager.prototype;
            if (!proto.switchScene) return;

            var orig = proto.switchScene;
            proto.switchScene = function (scene) {
                if (APP.config.DEBUG === false && ModuleCutter.BLOCKED_STATES.indexOf(scene) >= 0) {
                    log('已拦截对裁剪模块的跳转:', scene);
                    return;
                }
                return orig.apply(this, arguments);
            };
            log('状态守卫已安装');
        }
    };
    APP.ModuleCutter = ModuleCutter;

    // ========================== 8. 启动钩子 ==========================
    /**
     * 在 DOM 就绪且 jQuery 可用后安装补丁。
     * 由于 jQuery 先于本文件加载（见 index.html 的脚本顺序），
     * 这里直接安装；若尚未就绪则等待。
     */
    function boot() {
        // ---- 0. 先预载关键 JSON（消除加载竞态，见 preloadGameData 注释）----
        try { preloadGameData(); } catch (e) {
            console.error('[离线适配] JSON 预载异常:', e);
        }

        if (global.jQuery) {
            installAjaxPatch(global.jQuery);
        } else {
            // 轮询等待 jQuery
            var tries = 0;
            var t = setInterval(function () {
                if (global.jQuery) {
                    clearInterval(t);
                    installAjaxPatch(global.jQuery);
                } else if (++tries > 200) {
                    clearInterval(t);
                    console.error('[离线适配] 等待 jQuery 超时');
                }
            }, 20);
        }
        ModuleCutter.init();
    }

    if (global.document && global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    log('离线适配层已加载 v' + APP.version);
})(typeof window !== 'undefined' ? window : this);
