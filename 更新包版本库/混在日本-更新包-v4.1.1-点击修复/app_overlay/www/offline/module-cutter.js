/*!
 * ============================================================================
 * 离线适配层 · 模块裁剪器
 * ============================================================================
 * 依据用户决策裁剪以下联网模块：
 *   D2 —— 社团（Club）、FC 游戏厅（Emulator）、艺伎（Geisha）、黑金（RobLand）
 *   D3 —— 排行榜（Rank）
 *   D1 —— 内购（IAP，保留框架，不启用）
 *
 * 实现策略（三层保险，确保「入口消失 + 调用不崩」）：
 *   ① 功能开关层 —— 覆写 moduleFunctionManager 的判定函数（最优，UI 自然消失）
 *   ② UI 渲染层   —— 在渲染后主动隐藏相关按钮/面板
 *   ③ 调用兜底层 —— 对已裁剪模块的入口函数做空实现，杜绝异常
 * ============================================================================
 */
(function (global) {
    'use strict';

    var APP = global.HUN_PC || (global.HUN_PC = {});
    var CFG = APP.config;

    var Cutter = {
        _installed: false,

        install: function () {
            if (this._installed) return;
            this._installed = true;

            this._patchFunctionManager();
            this._patchEmulator();
            this._patchInnerGame();
            this._patchRank();
            this._patchPay();
            this._patchCrowdfund();

            console.log('[模块裁剪] 已安装（社团=' + CFG.ENABLE_CLUB +
                ' 内置小游戏=' + CFG.ENABLE_INNER_GAME +
                ' 排行=' + CFG.ENABLE_RANK +
                ' 众筹=' + CFG.ENABLE_CROWDFUND +
                ' 内购=' + CFG.ENABLE_IAP + '）');
        },

        /* ------------------------------------------------------------------
         * ① 功能开关层：覆写 moduleFunctionManager 判定
         *    这是最干净的方式 —— 游戏自身的渲染与事件分发都会尊重这些开关。
         * ---------------------------------------------------------------- */
        _patchFunctionManager: function () {
            var self = this;
            var tries = 0;

            var t = setInterval(function () {
                var M = global.ModuleFunctionManager;
                if (!M || !M.prototype || !M.prototype.init) {
                    if (++tries > 400) clearInterval(t);
                    return;
                }
                clearInterval(t);

                var proto = M.prototype;
                if (proto.__hunPatched) return;
                proto.__hunPatched = true;

                // ---- 社团（含艺伎 / 黑金 / FC 游戏厅的入口，均挂在社团体系下）----
                proto.hasOpenClubModule = function () {
                    return !!CFG.ENABLE_CLUB;
                };

                // ---- 排行榜：原版日本版走社团榜，这里改为个人榜（单机无排行）----
                // hasOpenClubModule=false 时，rankUnityBoard.showPersonal 会被调用；
                // 单机版无服务端排行，个人榜数据由本地提供（空榜）。

                // ---- 时间加速 / 挂机：保留（纯单机功能）----
                // hasOpenAccTimeFunction 保持原样

                console.log('[模块裁剪] moduleFunctionManager 已接管');
            }, 25);
        },

        /* ------------------------------------------------------------------
         * ② FC 游戏厅：整体禁用
         * ---------------------------------------------------------------- */
        _patchEmulator: function () {
            var tries = 0;
            var t = setInterval(function () {
                if (typeof global.GameEmulatorManager === 'undefined') {
                    if (++tries > 300) clearInterval(t);
                    return;
                }
                clearInterval(t);

                var EM = global.GameEmulatorManager;
                if (EM && EM.prototype && !EM.prototype.__hunPatched) {
                    EM.prototype.__hunPatched = true;
                    // 打开即关闭
                    ['openShowMe', 'init', 'start', 'loadGame', 'openEmulator'].forEach(function (m) {
                        if (typeof EM.prototype[m] === 'function') {
                            EM.prototype[m] = function () {
                                console.log('[模块裁剪] FC 游戏厅已禁用');
                                return null;
                            };
                        }
                    });
                }
                console.log('[模块裁剪] FC 游戏厅已禁用');
            }, 25);
        },

        /* ------------------------------------------------------------------
         * ③ 内置小游戏（FC 游戏厅 / 游戏机 / 2048 / 果冻跳跃 等）：整体禁用
         *
         *    背景：InnerGameManager 构造函数会调用 initInnerGame()，后者在
         *    「构造期」就为每个小游戏 new InnerGame(...)，其中 imgURL 指向
         *    远程 CDN（hun2web-1300260944.file.myqcloud.com/inner_game/...）。
         *    即便玩家永远不进游戏厅，这些远程图标也会在启动时被加载 —— 这是
         *    离线场景下唯一残留的外网请求来源。
         *
         *    审计结论（调用点穷举）：
         *      · initInnerGame()    —— 仅被 InnerGameManager 构造函数调用
         *      · getInnerGames(id)  —— 仅被城市热点构建器调用（生成 Hsc_InnerGame）
         *      · openInnerGame(url) —— 仅被 Hsc_InnerGame 热点内部调用
         *    即：整个模块是一座孤岛，切断 getInnerGames 即可让城市里不再生成
         *    任何小游戏热点，同时清空构造期缓存以杜绝远程图标请求。
         * ---------------------------------------------------------------- */
        _patchInnerGame: function () {
            if (CFG.ENABLE_INNER_GAME) return;

            var self = this;
            var tries = 0;

            var t = setInterval(function () {
                var M = global.InnerGameManager;
                if (!M || !M.prototype) {
                    if (++tries > 400) clearInterval(t);
                    return;
                }
                clearInterval(t);

                var proto = M.prototype;
                if (proto.__hunInnerPatched) return;
                proto.__hunInnerPatched = true;

                // ① 构造期短路：不再 new InnerGame(...) → 不再拼出任何远程 icon URL
                proto.initInnerGame = function () {
                    this.arrGameLevel_1 = [];
                    this.arrGameLevel_2 = [];
                    this.arrGameLevel_3 = [];
                    this.arrGameLevel_ftxd_1 = [];
                    this.arrGameLevel_ftxd_2 = [];
                    this.arrGameLevel_ftxd_3 = [];
                    this.currentHardWaveLevel = INNER_GAME_REQ_HARDWAVE_LEVEL_0;
                    return null;
                };

                // ② 查询期短路：城市热点构建器拿到空表 → 不生成任何小游戏热点
                proto.getInnerGames = function () {
                    return [];
                };

                // ③ 调用兜底：任何残留入口一律空实现
                proto.openInnerGame = function () {
                    console.log('[模块裁剪] 内置小游戏已禁用（D2）');
                    return null;
                };

                // ④ 立即清空本实例已缓存的远程图标引用
                self._clearInnerGames(global.mainManager && global.mainManager.innerGameManager);

                console.log('[模块裁剪] 内置小游戏（FC 游戏厅）已禁用');
            }, 25);
        },

        /* 清空已构造的 InnerGame 缓存，释放远程图标引用 */
        _clearInnerGames: function (mgr) {
            if (!mgr) return;
            ['arrGameLevel_1', 'arrGameLevel_2', 'arrGameLevel_3',
                'arrGameLevel_ftxd_1', 'arrGameLevel_ftxd_2', 'arrGameLevel_ftxd_3']
                .forEach(function (k) {
                    if (Array.isArray(mgr[k])) mgr[k].length = 0;
                });
        },

        /* ------------------------------------------------------------------
         * ④ 排行榜：单机版无服务端榜，禁用相关请求入口
         * ---------------------------------------------------------------- */
        _patchRank: function () {
            // 排行数据请求拦截已由 Router 处理（cut_rank 返回空榜），
            // 这里补充 UI 层的兜底：请求后若数据为空，不再重试
            var tries = 0;
            var t = setInterval(function () {
                var MM = global.MainManager;
                if (!MM || !MM.prototype) {
                    if (++tries > 300) clearInterval(t);
                    return;
                }
                clearInterval(t);

                var proto = MM.prototype;
                if (proto.__hunRankPatched) return;
                proto.__hunRankPatched = true;

                if (typeof proto.requestRankData_Personal === 'function') {
                    var orig = proto.requestRankData_Personal;
                    proto.requestRankData_Personal = function () {
                        if (!CFG.ENABLE_RANK) {
                            console.log('[模块裁剪] 排行榜请求已跳过');
                            return null;
                        }
                        return orig.apply(this, arguments);
                    };
                }
            }, 25);
        },

        /* ------------------------------------------------------------------
         * ⑤ 内购（D1）：禁用购买入口，保留代码与桥接框架
         * ---------------------------------------------------------------- */
        _patchPay: function () {
            if (CFG.ENABLE_IAP) return;  // 已启用则不处理

            var tries = 0;
            var t = setInterval(function () {
                var PM = global.PayManager;
                if (!PM || !PM.prototype) {
                    if (++tries > 300) clearInterval(t);
                    return;
                }
                clearInterval(t);

                var proto = PM.prototype;
                if (proto.__hunPayPatched) return;
                proto.__hunPayPatched = true;

                // 购买入口 → 提示「内购未开放」
                ['pay', 'startPay', 'doPay', 'requestPay', 'payHunCoin',
                    'showBuyHunCoin', 'buyProduct'].forEach(function (m) {
                        if (typeof proto[m] === 'function') {
                            proto[m] = function () {
                                console.log('[模块裁剪] 内购入口已禁用（D1：暂不开放）');
                                return null;
                            };
                        }
                    });

                // 启动时不再查询未完成订单
                ['checkUnPayHunCoin', 'checkUnPayHunCoin_Exe',
                    'checkUnhandleReceipt'].forEach(function (m) {
                        if (typeof proto[m] === 'function') {
                            proto[m] = function () { return null; };
                        }
                    });

                console.log('[模块裁剪] 内购入口已禁用（框架保留）');
            }, 25);
        },

        /* ------------------------------------------------------------------
         * ⑥ 众筹 / 乞讨：禁用
         * ---------------------------------------------------------------- */
        _patchCrowdfund: function () {
            if (CFG.ENABLE_CROWDFUND) return;

            var tries = 0;
            var t = setInterval(function () {
                var MM = global.MainManager;
                if (!MM || !MM.prototype) {
                    if (++tries > 300) clearInterval(t);
                    return;
                }
                clearInterval(t);

                var proto = MM.prototype;
                if (proto.__hunCrowdPatched) return;
                proto.__hunCrowdPatched = true;

                ['requestForMoney', 'requestCrowdfundStuff', 'postCrowdfundData']
                    .forEach(function (m) {
                        if (typeof proto[m] === 'function') {
                            proto[m] = function () {
                                console.log('[模块裁剪] 众筹功能已禁用');
                                return null;
                            };
                        }
                    });
            }, 25);
        }
    };

    APP.ModuleCutter = Cutter;
    global.HUN_PC.ModuleCutter = Cutter;

    // ---- 自装配兜底 ----
    // 正常情况下由 start.js 的 installModuleCutter() 轮询到本文件后调用 install()。
    // 这里再加一道保险：若 800ms 内仍未有人调用，则自行装配，确保裁剪一定生效。
    if (!global.__hunModuleCutterInstalled) {
        setTimeout(function () {
            if (!global.__hunModuleCutterInstalled) {
                global.__hunModuleCutterInstalled = true;
                try {
                    Cutter.install();
                } catch (e) {
                    console.error('[模块裁剪] 自装配失败:', e);
                }
            }
        }, 800);
    }

    console.log('[模块裁剪器] 已加载');
})(typeof window !== 'undefined' ? window : this);
