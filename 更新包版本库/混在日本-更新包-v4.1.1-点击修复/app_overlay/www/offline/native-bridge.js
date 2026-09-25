/*!
 * ============================================================================
 * 离线适配层 · 原生桥（jsbridge_android 兼容）
 * ============================================================================
 * 原 APK 中，hun_min.js 通过 window.jsbridge_android.callbackJs(str) 调用
 * 安卓原生能力。PC 版在 Electron 下由 preload 暴露 __hunBridge 承接。
 *
 * 本文件负责在原位置上重建 jsbridge_android 对象，
 * 保持与 APK 完全一致的调用契约，实现「原子化一比一复刻」。
 * ============================================================================
 */
(function (global) {
    'use strict';

    var APP = global.HUN_PC || (global.HUN_PC = {});

    // ============================ 桥实现 ============================
    var bridge = {
        /**
         * 对应 JsToAndroid.callbackJs(String)
         * @param {string} str 形如 "cmd&key=value&key2=value2"
         */
        callbackJs: function (str) {
            try {
                var raw = String(str == null ? '' : str);
                if (global.__hunBridge && global.__hunBridge.invoke) {
                    global.__hunBridge.invoke(raw).then(function (res) {
                        dispatchResult(res);
                    }).catch(function (e) {
                        console.warn('[原生桥] 调用失败:', raw, e);
                    });
                } else {
                    // 非 Electron 环境（浏览器调试）：本地兜底
                    dispatchResult(localFallback(raw));
                }
            } catch (e) {
                console.error('[原生桥] 异常:', e);
            }
        }
    };

    /** 把原生返回结果回灌给游戏 */
    function dispatchResult(res) {
        if (!res || !res.cmd) return;
        var cmd = res.cmd;
        switch (cmd) {
            case 'uuid':
                if (res.uuid && global.setAndroidUuid) {
                    try { global.setAndroidUuid(res.uuid); } catch (e) { }
                }
                break;
            case 'base_url':
                break;
            case 'saveKY':
                callIfExists('fromAndroid_saveKYResult', 'OK');
                break;
            case 'getKY':
                callIfExists('fromAndroid_getKYResult', res.value || '');
                break;
            case 'googleplay':
            case 'googleplayReview':
                callIfExists('fromAndroid_GooglePlayResult', 'CANCEL');
                break;
            default:
                break;
        }
    }

    function callIfExists(name, arg) {
        try {
            if (typeof global[name] === 'function') global[name](arg);
        } catch (e) { }
    }

    // ============================ 浏览器兜底 ============================
    /** 非 Electron 环境下的最小可用实现，便于浏览器直接调试 */
    function localFallback(raw) {
        var parts = String(raw).split('&');
        var cmd = (parts.shift() || '').trim();
        var kv = {};
        parts.forEach(function (p) {
            var i = p.indexOf('=');
            if (i > 0) kv[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
        });

        switch (cmd) {
            case 'uuid': {
                var u = getLocalUuid();
                return { cmd: cmd, uuid: u };
            }
            case 'getKY': {
                var v = '';
                try { v = global.localStorage.getItem('ky_' + (kv.key || 'default')) || ''; } catch (e) { }
                return { cmd: cmd, value: v };
            }
            case 'saveKY': {
                try { global.localStorage.setItem('ky_' + (kv.key || 'default'), kv.value || ''); } catch (e) { }
                return { cmd: cmd, ok: true };
            }
            case 'deleteKY': {
                try { global.localStorage.removeItem('ky_' + (kv.key || 'default')); } catch (e) { }
                return { cmd: cmd, ok: true };
            }
            case 'audiovibrate':
            case 'remove_splash':
            case 'show_splash':
            case 'remove_reloadbutton':
            case 'reset_label_text':
            case 'base_url':
                return { cmd: cmd, ok: true };
            case 'checkRoot':
                return { cmd: cmd, ok: true, rooted: false };
            case 'getSystemMemory':
            case 'getAppMaxMemory':
            case 'getAppTotalMemory':
            case 'getAppFreeMemory':
                return { cmd: cmd, ok: true, value: '0' };
            default:
                return { cmd: cmd, ok: false, unknown: true };
        }
    }

    function getLocalUuid() {
        var KEY = 'hjo_device_uuid';
        try {
            var v = global.localStorage.getItem(KEY);
            if (v) return v;
            var s = 'pc-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
            global.localStorage.setItem(KEY, s);
            return s;
        } catch (e) {
            return 'pc-fallback-uuid';
        }
    }

    // ============================ 安装 ============================
    // 直接占据全局同名对象，游戏核心无需任何改动即可调用
    global.jsbridge_android = bridge;

    // 同时暴露常用回调占位，避免游戏侧检查时报 undefined
    var CALLBACKS = [
        'fromAndroid_GooglePlayResult', 'fromAndroid_WxPayResult',
        'fromAndroid_AlipayResult', 'fromAndroid_ShareQQResult',
        'fromAppOpenShowLoading', 'fromAppCloseShowLoading',
        'fromAppOpenAccessibility'
    ];
    CALLBACKS.forEach(function (n) {
        if (typeof global[n] !== 'function') {
            global[n] = function () { /* 占位，由游戏核心按需覆写 */ };
        }
    });

    console.log('[原生桥] jsbridge_android 兼容层已安装');
})(typeof window !== 'undefined' ? window : this);
