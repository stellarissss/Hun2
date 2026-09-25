/*!
 * ============================================================================
 * PC 交互层 · pc-ux.js
 * ============================================================================
 * 目标：让 PC 端地图「可拖曳、可滚轮缩放、可双击复位」，并在地图缩小时
 *      看到更完整的全图。
 *
 * 设计原则（重要）：
 *   1. 本文件是**唯一**为 PC 交互新增的源文件；`js/hun_min.js` 保持字节级
 *      零改动，全部能力通过运行时 monkey-patch 注入 —— 便于日后回退与替换。
 *   2. hun_min.js 是顶层脚本作用域（无 IIFE），因此 `MapScroll` /
 *      `BaseComponent` / `userMouse` / `gCanvas` 均为全局符号，可直接包装。
 *   3. 缩放**只作用于地图类实例**（JapanMap / CityMap / CityMap_Type2），
 *      其余 UI（按钮/面板/文字）完全不受影响，避免全局缩放导致界面错乱。
 *   4. 缩放实现在「贴图绘制尺寸」层（picW/picH），而非全局 canvas 变换，
 *      这样 MapScroll 自带的滚动边界（initScrollParam）与惯性系统无需重写。
 *   5. 未改动任何坐标换算常量；拖曳直接复用 hun_min.js 中已实现但未注册的
 *      `userMouse()`（L110），零成本激活平移 + 惯性。
 *
 * 交互：
 *   · 左键拖曳      → 平移地图（带惯性）
 *   · 滚轮上下      → 以鼠标为锚点缩放（0.25x ~ 3.0x）
 *   · 双击          → 复位到 1.0x 并居中
 *   · Ctrl + 滚轮   → 同步缩放（与滚轮一致，方便触控板用户）
 * ============================================================================
 */
(function (global) {
    'use strict';

    // ============================ 配置 ============================
    var CONFIG = {
        MIN_SCALE: 0.25,
        MAX_SCALE: 3.0,
        WHEEL_STEP: 1.12,      // 每格滚轮的缩放倍率
        ZOOM_EPS: 0.001,
        HUD_LIFE_MS: 1400      // 缩放角标显示时长
    };

    var state = {
        installed: false,
        hudUntil: 0,
        hudText: ''
    };

    // ============================ 工具 ============================

    function log() {
        if (!global.console || !console.log) return;
        var a = ['[PC交互]'].concat(Array.prototype.slice.call(arguments));
        console.log.apply(console, a);
    }

    function warn() {
        if (!global.console || !console.warn) return;
        var a = ['[PC交互]'].concat(Array.prototype.slice.call(arguments));
        console.warn.apply(console, a);
    }

    function clamp(v, lo, hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    /** 当前是否处于「宽屏（横屏）」形态 */
    function isWide() {
        try {
            return global.innerWidth > global.innerHeight;
        } catch (e) { return false; }
    }

    /** 取得游戏画布（hun_min.js 中名为 gCanvas 的全局） */
    function getCanvas() {
        var g = global.gCanvas;
        if (g && typeof g.addEventListener === 'function') return g;
        try { return document.getElementById('gameCanvas'); } catch (e) { return null; }
    }

    /**
     * 读取当前正在显示的地图实例（大地图或城市地图）。
     * 返回 null 表示当前界面不是地图场景。
     */
    function getActiveMap() {
        try {
            var mm = global.mainManager;
            if (!mm || typeof mm.getScene !== 'function') return null;
            var pm = mm.playManager;
            if (!pm || pm === mm) return null;

            // 大地图（选择城市）
            var jm = pm.japanMapManager;
            if (jm && jm.japanMap && jm.japanMap.__zoomable) {
                if (isMapVisible(jm.japanMap)) return jm.japanMap;
            }

            // 城市内部地图
            var cm = pm.cityManager;
            if (cm && cm.curCity) {
                var cityMap = cm.curCity.cityMap;
                if (cityMap && cityMap.__zoomable && isMapVisible(cityMap)) return cityMap;
            }
        } catch (e) { /* 场景未就绪，忽略 */ }
        return null;
    }

    /** 粗略判定地图是否在当前可见区域内（避免对隐藏地图缩放） */
    function isMapVisible(map) {
        if (!map) return false;
        var w = map.w, h = map.h;
        return typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0;
    }

    /** 鼠标点是否落在该地图的可见矩形内 */
    function pointInMap(map, cssX, cssY) {
        if (!map) return false;
        try {
            var r = (typeof map.getCanvasScale === 'function') ? map.getCanvasScale() : 1;
            return cssX >= map.x * r && cssX <= (map.x + map.w) * r &&
                   cssY >= map.y * r && cssY <= (map.y + map.h) * r;
        } catch (e) { return false; }
    }

    // ============================ 一、地图缩放核心 ============================

    /**
     * 取得实例的基准（1.0x）贴图尺寸。
     * 首次调用时把当前的 picW/picH 记录为基准。
     */
    function baseSize(map) {
        if (map.__basePicW == null) {
            map.__basePicW = map.picW;
            map.__basePicH = map.picH;
        }
        return { w: map.__basePicW, h: map.__basePicH };
    }

    /**
     * 应用缩放。
     *
     * 数学：
     *   scale 变化时，保持「锚点（鼠标位置）对应的地图内容点」不动。
     *   设 s0/s1 为缩放前后倍率，锚点在画布上的位置为 (ax, ay)：
     *     contentX = (ax - x - scrollX) / s0     // 锚点对应的地图内容坐标（1.0x 基准）
     *     scrollX_new = ax - x - contentX * s1
     *   若未提供锚点，则以地图可视区中心为锚点。
     *
     * 边界：picW/picH 按 s1 缩放后，调用 initScrollParam() 重算
     *       min/max_scroll，再对 scrollX/scrollY 做 clamp。
     *
     * @param {Object} map  地图实例
     * @param {Number} s    目标倍率（会被 clamp 到 [MIN, MAX]）
     * @param {Number} [ax] 锚点 x（画布坐标，CSS 像素）
     * @param {Number} [ay] 锚点 y
     */
    function setMapScale(map, s, ax, ay) {
        if (!map || !map.__zoomable) return false;

        var base = baseSize(map);
        var s0 = map.__viewScale || 1;
        var s1 = clamp(s, CONFIG.MIN_SCALE, CONFIG.MAX_SCALE);
        if (Math.abs(s1 - s0) < CONFIG.ZOOM_EPS) return false;

        // 锚点缺省 = 地图可视区中心
        if (ax == null) ax = map.x + map.w / 2;
        if (ay == null) ay = map.y + map.h / 2;

        // 锚点对应的内容坐标（以 1.0x 贴图为准）
        var contentX = (ax - map.x - map.scrollX) / s0;
        var contentY = (ay - map.y - map.scrollY) / s0;

        // 应用新尺寸
        map.__viewScale = s1;
        map.picW = base.w * s1;
        map.picH = base.h * s1;

        // 重算滚动边界
        if (typeof map.initScrollParam === 'function') map.initScrollParam();

        // 若贴图已小于可视区，则居中显示并锁定拖曳（避免地图"飘"出屏幕外）
        var fitsX = map.picW <= map.w;
        var fitsY = map.picH <= map.h;
        if (fitsX) { map.min_scrollX = map.max_scrollX = (map.w - map.picW) / 2; }
        if (fitsY) { map.min_scrollY = map.max_scrollY = (map.h - map.picH) / 2; }

        // 按锚点求解新 scroll，并写回（走 setScrollXY 以触发子类按钮同步）
        var nx = fitsX ? map.min_scrollX : (ax - map.x - contentX * s1);
        var ny = fitsY ? map.min_scrollY : (ay - map.y - contentY * s1);

        // setScrollXY 是「增量」语义，这里换算成增量再调用
        var dx = nx - map.scrollX;
        var dy = ny - map.scrollY;
        if (typeof map.setScrollXY === 'function') {
            map.setScrollXY(dx, dy);
        } else {
            map.scrollX = nx; map.scrollY = ny;
            map.drawPicX = map.x + nx; map.drawPicY = map.y + ny;
        }

        // 按钮热点跟随缩放后的坐标（子类的 setScrollXY 用的是旧 orgX，故此处修正）
        resyncHotspots(map);

        showHud(s1.toFixed(2) + 'x');
        return true;
    }

    /**
     * 让地图上的城市/热点按钮跟随缩放后的坐标。
     *
     * 背景：JapanMap / CityMap / CityMap_Type2 的 setScrollXY 内部都会执行
     *   `c.x = this.drawPicX + c.orgX ; c.y = this.drawPicY + c.orgY`
     * 其中 orgX/orgY 是**贴图 1.0x 坐标**，不随缩放变化。因此缩放后按钮必须
     * 用 orgX*scale 重新定位，否则会与地图脱节。
     *
     * 做法：记录每个按钮的基准 orgX/orgY，然后按当前倍率重写 orgX/orgY
     *   orgX_eff = baseOrgX * scale
     * 这样父类/子类原有的 `drawPicX + orgX` 逻辑无需改动即可正确定位。
     */
    function resyncHotspots(map) {
        var s = map.__viewScale || 1;
        var arrs = [map.arrBtnCity, map.arrBtnHs];
        for (var k = 0; k < arrs.length; k++) {
            var arr = arrs[k];
            if (!arr || !arr.length) continue;
            for (var i = 0; i < arr.length; i++) {
                var b = arr[i];
                if (!b) continue;

                // 首次记录基准（1.0x）坐标，避免反复乘算导致漂移
                if (b.__orgXBase == null) {
                    b.__orgXBase = (typeof b.orgX === 'number') ? b.orgX : 0;
                    b.__orgYBase = (typeof b.orgY === 'number') ? b.orgY : 0;
                    b.__wBase = (typeof b.w === 'number') ? b.w : 0;
                    b.__hBase = (typeof b.h === 'number') ? b.h : 0;
                }

                b.orgX = b.__orgXBase * s;
                b.orgY = b.__orgYBase * s;

                // 按钮本体也随贴图一起缩放，保持视觉一致
                if (b.__wBase) b.w = b.__wBase * s;
                if (b.__hBase) b.h = b.__hBase * s;

                // 立即按新 org 定位
                b.x = map.drawPicX + b.orgX;
                b.y = map.drawPicY + b.orgY;

                if (typeof b.initButtonPicLabelComponent === 'function') {
                    try { b.initButtonPicLabelComponent(); } catch (e) { }
                }
            }
        }
    }

    /** 复位到 1.0x */
    function resetScale() {
        var map = getActiveMap();
        if (!map) return false;
        var ok = setMapScale(map, 1);
        // 复位后把视野居中到地图内容中心
        if (map.__viewScale === 1) centerMap(map);
        showHud('1.00x');
        return ok;
    }

    /** 把地图内容居中显示 */
    function centerMap(map) {
        if (!map) return;
        var base = baseSize(map);
        var s = map.__viewScale || 1;
        var targetX = (map.w - base.w * s) / 2;
        var targetY = (map.h - base.h * s) / 2;
        // clamp 到合法范围
        targetX = clamp(targetX, map.min_scrollX, map.max_scrollX);
        targetY = clamp(targetY, map.min_scrollY, map.max_scrollY);

        // 内容小于可视区时，直接居中（放开 clamp）
        if (base.w * s <= map.w) targetX = (map.w - base.w * s) / 2;
        if (base.h * s <= map.h) targetY = (map.h - base.h * s) / 2;

        var dx = targetX - map.scrollX;
        var dy = targetY - map.scrollY;
        if (typeof map.setScrollXY === 'function') map.setScrollXY(dx, dy);
        resyncHotspots(map);
    }

    // ============================ 二、缩放角标 HUD ============================

    function showHud(text) {
        state.hudText = text;
        state.hudUntil = nowMs() + CONFIG.HUD_LIFE_MS;
    }

    function nowMs() {
        return (global.performance && performance.now) ? performance.now() : Date.now();
    }

    /**
     * HUD 绘制：挂到主循环之后，每帧检查是否需要画角标。
     * 通过包装 MainManager.prototype.gameLoop 实现（不侵入 gameLogic/render）。
     */
    function installHud() {
        var MM = global.MainManager;
        if (!MM || !MM.prototype || !MM.prototype.gameLoop) return false;
        var proto = MM.prototype;
        if (proto.__pcHudInstalled) return true;
        var orig = proto.gameLoop;
        proto.gameLoop = function () {
            var r = orig.apply(this, arguments);
            try { drawHudIfNeeded(this); } catch (e) { }
            return r;
        };
        proto.__pcHudInstalled = true;
        return true;
    }

    function drawHudIfNeeded(mm) {
        if (nowMs() > state.hudUntil) return;
        if (!mm || !mm.canvasContext) return;

        var ctx = mm.canvasContext;
        var cs = (global.devicePixelRatio || 1);
        var W = mm.canvasObject ? mm.canvasObject.width : 0;
        var H = mm.canvasObject ? mm.canvasObject.height : 0;
        if (!W || !H) return;

        var text = state.hudText || '1.00x';
        var pad = 18 * cs;
        var boxW = 110 * cs, boxH = 46 * cs;
        var x = W - boxW - pad, y = H - boxH - pad;
        if (isWide()) { x = W - boxW - pad; }

        ctx.save();
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        roundRect(ctx, x, y, boxW, boxH, 8 * cs);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#e8dcc0';
        ctx.font = 'bold ' + Math.round(24 * cs) + 'px "Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + boxW / 2, y + boxH / 2 + 1 * cs);
        ctx.restore();
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    // ============================ 三、鼠标拖曳（逐帧注入） ============================
    //
    // 【原理：复用游戏原生的 userMouse，而不是自己重写一套】
    //
    // 排查发现：hun_min.js 里早就写好了完整的鼠标处理器 `userMouse(event)`，
    // 它把 mousedown/mousemove/mouseup 翻译成游戏引擎消费的
    // touchStartX/touchMove_X/touchMove_StepX/... 变量族，并按原逻辑累加 step：
    //
    //     case "mousedown": touchStartX=b.clientX; touchStartY=b.clientY;
    //                       touchMove_PreX=touchMove_X=null; ... break;
    //     case "mousemove": touchMove_X=touchMoveX=b.clientX;
    //                       touchMove_StepX += (touchMove_X - touchMove_PreX);
    //                       touchMove_PreX = touchMove_X; ... break;
    //     case "mouseup":   touchEndX=b.clientX; touchEndY=b.clientY; ... break;
    //
    // 但它从未被注册，只注册了 `userTouch`：
    //
    //     hasInput_TouchNotMouse = channel==CHANNEL_PC ? !1 : !0;
    //     hasInput_TouchNotMouse = !0;        // ← 上一行的 PC 判断被无条件覆盖
    //     gCanvas.addEventListener("touchstart", userTouch, !1);   // 只有触摸
    //
    // 【为什么早期“直接注册 userMouse”会失败】
    // MainManager.userInput() 是一个「按帧消费」循环：每帧末尾把
    //     touchEndY = touchEndX = touchStartY = touchStartX
    //              = touchMove_StepY = touchMove_StepX = clickY = clickX = null
    // 全部清零；而它开头又有门控——只有上述变量之一非 null 才进入分发分支。
    // 因此鼠标事件必须在「两帧之间」持续刷新这些变量，靠事件自身重填即可，
    // 因为 mousemove 事件频率（~125Hz）远高于主循环门控的空转频率（50ms）。
    //
    // 早期失败的真实原因是测试环境未进入游戏场景（停在开始菜单/剧情对话框），
    // 导致 MapScroll.userInput() 根本没被调用 —— 而非 userMouse 有问题。
    //
    // 【最终方案】
    //   1) 把原生 userMouse 注册到 canvas 与 window（mousedown 在 canvas，
    //      move/up 挂 window 以便拖出画布也能正确收尾）；
    //   2) 仅做两件“PC 增强”：
    //      a. 拖曳判定——越过阈值后不再产生 click，避免松手误触城市按钮；
    //      b. cursor 反馈（grab / grabbing）。

    var mouseState = {
        down: false,
        downX: 0, downY: 0,          // 按下位置（CSS 像素）
        curX: 0, curY: 0,
        dragging: false,             // 是否已越过拖曳阈值
        swallowNextClick: false      // 是否要吞掉紧随其后的那一次 click
    };

    /**
     * 拖曳判定阈值（CSS 像素）。
     *
     * 【必须足够大】早期设为 4px，导致真实鼠标点击被误判为拖曳：
     *   人手按住左键时，从 mousedown 到 mouseup 之间天然有 1~5px 漂移，
     *   4px 阈值下「几乎每次点击都越过阈值」→ dragging 置真 → click 被吞
     *   → 表现为「什么都点不了」。
     * 取 8px 作为容忍上限：既覆盖人手抖动，又远小于有意拖动（通常 30px+）。
     */
    var DRAG_THRESHOLD = 8;

    /**
     * 保留 hasInput_TouchNotMouse 的原值，不做任何改写。
     *
     * 【为什么不再改动它】hun_min.js 末尾写的是：
     *     hasInput_TouchNotMouse = channel == CHANNEL_PC ? !1 : !0;
     *     hasInput_TouchNotMouse = !0;        // ← 无条件覆盖
     * 即该量在 PC 端**始终为 true**，走 onclick 的「直接赋值」分支：
     *     clickX = clientX - offsetLeft + scrollLeft;   // 无任何过滤
     *
     * 早期版本曾「自作聪明」把它改成 false，想启用 3px 抖动过滤，结果适得其反：
     * false 分支要求 |mouseDownX - clickX| < 3，而真实鼠标点击的按下/抬起
     * 位置差普遍 >3px → clickX 永不被赋值 → 点击全部失效。
     *
     * 结论：**保持游戏原始行为**（true），点击永远不做抖动过滤。
     * 「拖曳不该误触按钮」由下方的 click 吞掉机制负责，与取值路径无关。
     */
    function installInputModeFix() {
        return true;
    }

    function installMouseInput() {
        var g = getCanvas();
        if (!g) return false;
        if (g.__pcMouseBound) return true;

        var nativeMouse = global.userMouse;         // 游戏原生处理器（全局函数）
        if (typeof nativeMouse !== 'function') {
            log('未找到原生 userMouse，鼠标增强跳过');
            return false;
        }

        // ---- mousedown：交给原生处理器，同时记录拖曳起点 ----
        g.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;             // 仅左键
            mouseState.down = true;
            mouseState.dragging = false;
            mouseState.swallowNextClick = false;    // 每次按下都重置，杜绝状态残留
            mouseState.downX = e.clientX;
            mouseState.downY = e.clientY;
            mouseState.curX = e.clientX;
            mouseState.curY = e.clientY;
            if (g.style) g.style.cursor = 'grabbing';
            nativeMouse(e);                         // ← 原生逻辑填 touchStartX/Y
        }, false);

        // ---- mousemove / mouseup 挂 window：拖出画布也能正确结束 ----
        global.addEventListener('mousemove', function (e) {
            if (!mouseState.down) return;
            mouseState.curX = e.clientX;
            mouseState.curY = e.clientY;
            var dx = e.clientX - mouseState.downX;
            var dy = e.clientY - mouseState.downY;
            if (!mouseState.dragging &&
                (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                mouseState.dragging = true;
            }
            nativeMouse(e);                         // ← 原生逻辑累加 touchMove_StepX/Y
        }, false);

        global.addEventListener('mouseup', function (e) {
            if (e.button !== 0) return;
            if (mouseState.down) nativeMouse(e);     // ← 原生逻辑填 touchEndX/Y
            // 只有「确实拖动过」才预约吞掉随后的 click
            mouseState.swallowNextClick = mouseState.dragging;
            mouseState.down = false;
            mouseState.dragging = false;
            if (g.style) g.style.cursor = 'grab';
        }, false);

        // ---- click 抑制：仅吞掉「拖曳结束时」补发的那一次 click ----
        //
        // 关键修复点：早前版本把「是否吞掉」直接绑定在 mouseState.dragging 上，
        // 且只在真的吞掉时才复位 dragging。一旦出现「拖曳后浏览器未补发 click」
        // （例如拖到画布外松手、或拖动后点击被别处消化），dragging 就永久残留
        // 为 true，之后**每次点击都被吞** → 表现正是「什么都点不了」。
        //
        // 现在改为：
        //   · 吞不吞由 mouseup 时一次性结算的 swallowNextClick 决定；
        //   · 无论是否命中，本函数都把标志复位（绝对不留残留状态）。
        g.addEventListener('click', function (e) {
            if (mouseState.swallowNextClick) {
                mouseState.swallowNextClick = false;
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);                                   // capture 阶段先于原生 onclick

        // 防止拖曳时选中文字 / 触发原生拖拽
        g.addEventListener('dragstart', function (e) { e.preventDefault(); }, false);
        if (g.style) g.style.cursor = 'grab';

        g.__pcMouseBound = true;
        log('鼠标拖曳已启用（复用原生 userMouse，阈值 ' + DRAG_THRESHOLD + 'px）');
        return true;
    }

    /**
     * 兼容位：早期版本依赖「逐帧注入」，现改为复用原生 userMouse，
     * 主循环无需再被包装。保留空实现以维持 install() 调用顺序稳定。
     */
    function installFrameInjection() {
        return true;
    }

    /** 下游坐标倍率 = SCALE_SCREEN × CANVAS_SCALE（两者均为全局） */
    function coordFactor() {
        var a = (typeof global.SCALE_SCREEN === 'number') ? global.SCALE_SCREEN : 1;
        var b = (typeof global.CANVAS_SCALE === 'number') ? global.CANVAS_SCALE : 1;
        var k = a * b;
        return (k > 0) ? k : 1;
    }

    // ============================ 四、滚轮缩放 & 双击复位 ============================

    function installWheelZoom() {
        var g = getCanvas();
        if (!g) return false;
        if (g.__pcWheelBound) return true;

        g.addEventListener('wheel', function (e) {
            var map = getActiveMap();
            if (!map) return;

            // 鼠标位置（CSS 像素）
            var cssX = e.clientX, cssY = e.clientY;

            // 允许对整张地图区域缩放；若鼠标不在当前地图内则忽略（不抢滚动条）
            if (!pointInMap(map, cssX, cssY)) return;

            e.preventDefault();
            e.stopPropagation();

            var s0 = map.__viewScale || 1;
            var factor = (e.deltaY < 0) ? CONFIG.WHEEL_STEP : (1 / CONFIG.WHEEL_STEP);
            setMapScale(map, s0 * factor, cssX, cssY);
        }, { passive: false });

        // 阻止 Ctrl+滚轮 触发浏览器页面缩放
        global.addEventListener('wheel', function (e) {
            if (e.ctrlKey && e.preventDefault) e.preventDefault();
        }, { passive: false });

        g.__pcWheelBound = true;
        log('滚轮缩放已启用（' + CONFIG.MIN_SCALE + 'x ~ ' + CONFIG.MAX_SCALE + 'x，锚点缩放）');
        return true;
    }

    function installDoubleClickReset() {
        var g = getCanvas();
        if (!g) return false;
        if (g.__pcDblBound) return true;

        g.addEventListener('dblclick', function (e) {
            var map = getActiveMap();
            if (!map) return;
            if (!pointInMap(map, e.clientX, e.clientY)) return;
            e.preventDefault();
            resetScale();
            log('双击复位 → 1.00x');
        }, false);

        g.__pcDblBound = true;
        return true;
    }

    // ============================ 五、地图类实例标记 ============================

    /**
     * 给三个地图类打标记：
     *   · 新实例自动继承 __zoomable = true
     *   · 记录基准 picW/picH
     *   · 初始化 __viewScale = 1
     *
     * 采用「包装构造函数」的方式：保持原型链与 instanceof 不变，
     * 仅在新实例上补字段。若运行时已存在实例，也会被就地补标记。
     */
    function markMapClasses() {
        var names = ['JapanMap', 'CityMap', 'CityMap_Type2'];
        var allOk = true;

        for (var i = 0; i < names.length; i++) {
            var n = names[i];
            var C = global[n];
            if (typeof C !== 'function') { allOk = false; continue; }
            if (C.__pcZoomMarked) continue;

            global[n] = wrapConstructor(C, n);
            global[n].__pcZoomMarked = true;
            global[n].__pcOrigCtor = C;
        }
        return allOk;
    }

    /** 包装构造器：实例化后补上缩放所需字段 */
    function wrapConstructor(Ctor, name) {
        function Wrapped() {
            var inst = new (Function.prototype.bind.apply(Ctor, [null].concat(
                Array.prototype.slice.call(arguments)
            )))();

            inst.__zoomable = true;
            inst.__viewScale = 1;
            inst.__pcMapName = name;
            // 记录基准尺寸（构造完成后 picW/picH 已被赋值）
            inst.__basePicW = inst.picW;
            inst.__basePicH = inst.picH;

            return inst;
        }
        Wrapped.prototype = Ctor.prototype;
        try { Object.setPrototypeOf(Wrapped, Ctor); } catch (e) { }
        Wrapped.constructorName = name;
        return Wrapped;
    }

    /**
     * 对「已经存在」的地图实例补标记 —— 应对 pc-ux.js 加载晚于首个
     * 地图实例创建的情况（轮询场景切换时调用）。
     */
    function markExistingInstances() {
        try {
            var mm = global.mainManager;
            if (!mm) return;
            var pm = mm.playManager;
            if (!pm || pm === mm) return;

            var cands = [];
            if (pm.japanMapManager && pm.japanMapManager.japanMap) cands.push(pm.japanMapManager.japanMap);
            if (pm.cityManager && pm.cityManager.curCity && pm.cityManager.curCity.cityMap) {
                cands.push(pm.cityManager.curCity.cityMap);
            }
            for (var i = 0; i < cands.length; i++) {
                var m = cands[i];
                if (m && !m.__zoomable) {
                    m.__zoomable = true;
                    m.__viewScale = 1;
                    m.__basePicW = m.picW;
                    m.__basePicH = m.picH;
                    log('已就地为既有地图实例补标记：', m.__pcMapName || '(unknown)');
                }
            }
        } catch (e) { }
    }

    // ============================ 六、对外 API ============================

    var API = {
        CONFIG: CONFIG,

        /** 当前缩放倍率（活动地图） */
        getScale: function () {
            var m = getActiveMap();
            return m ? (m.__viewScale || 1) : 1;
        },

        /** 以可选锚点设置缩放 */
        setScale: function (s, ax, ay) {
            var m = getActiveMap();
            if (!m) return false;
            return setMapScale(m, s, ax, ay);
        },

        /** 放大 / 缩小 / 复位 */
        zoomIn: function () { return API.setScale(API.getScale() * CONFIG.WHEEL_STEP); },
        zoomOut: function () { return API.setScale(API.getScale() / CONFIG.WHEEL_STEP); },
        reset: function () { return resetScale(); },

        /** 供外部（如 Electron 菜单 / 测试脚本）直接调用 */
        getActiveMap: getActiveMap,
        setMapScale: setMapScale,

        /** 安装全部能力 */
        install: install
    };

    // ============================ 安装流程 ============================

    /**
     * 画布倍率防抖：在 MainManager.init() 之内、画布尺寸确定之前，
     * 再把 CANVAS_SCALE 钉一次 1（防止 initCanvasScale 在极端时序下
     * 覆写成 devicePixelRatio）。
     */
    function installScaleGuard() {
        var MM = global.MainManager;
        if (!MM || !MM.prototype || !MM.prototype.init) return false;
        if (MM.prototype.__pcScaleGuard) return true;
        var orig = MM.prototype.init;
        MM.prototype.init = function () {
            try { global.CANVAS_SCALE = 1; } catch (e) { }
            return orig.apply(this, arguments);
        };
        MM.prototype.__pcScaleGuard = true;
        return true;
    }

    function install() {
        if (state.installed) return true;

        installScaleGuard();
        installInputModeFix();      // 保留性调用（不改写原值，见函数注释）
        installFrameInjection();
        var okMouse = installMouseInput();
        var okZoomCls = markMapClasses();
        var okWheel = installWheelZoom();
        var okDbl = installDoubleClickReset();
        installHud();
        markExistingInstances();

        // 任一步骤因脚本时序未就绪 → 轮询补装
        if (!okZoomCls || !okMouse || !okWheel) {
            pollInstall();
            return false;
        }

        state.installed = true;
        log('已就绪（鼠标拖曳 / 滚轮缩放 / 双击复位）');
        return true;
    }

    var pollTries = 0;
    function pollInstall() {
        if (pollTries++ > 800) {          // 800 × 25ms = 20s
            warn('安装超时：部分能力可能未启用');
            return;
        }
        setTimeout(function () {
            if (state.installed) return;
            installScaleGuard();
            installFrameInjection();
            var okMouse = installMouseInput();
            var okZoomCls = markMapClasses();
            var okWheel = installWheelZoom();
            installDoubleClickReset();
            installHud();
            markExistingInstances();

            if (okMouse && okZoomCls && okWheel) {
                state.installed = true;
                log('已就绪（轮询补装完成）');
            } else {
                pollInstall();
            }
        }, 25);
    }

    global.PCUX = API;

    // 脚本在 </body> 处加载，此时 hun_min.js 已执行；
    // 若尚未就绪则由内部轮询兜底。
    if (!install()) {
        // 兜底：DOM 就绪后再试一次
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { install(); }, false);
        }
        global.addEventListener('load', function () { install(); }, false);
    }

})(window);
