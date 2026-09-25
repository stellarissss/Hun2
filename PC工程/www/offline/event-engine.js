/*!
 * ============================================================================
 * 离线适配层 · 本地事件引擎
 * ============================================================================
 * 原版 getEvent.do 由服务端下发随机事件。单机版必须在本地复刻这一机制。
 *
 * 事件契约（严格对齐 hun_min.js 中 handleUserChoiceEvent_* 的消费字段）：
 *
 *   {
 *     type:      'interaction'   // 交互式（YES/NO）——本引擎产出
 *                'lost_goods'    // 丢失货物
 *                'give_goods'    // 获得货物（需分享，PC 端自动跳过分享）
 *     title:     String          // 标题
 *     story:     String          // 正文（可含 $NEW_LINE$）
 *     audioKey:  String          // 播放的音效 id
 *     health:    Number          // 生命变化（正加负减）
 *     cash:      Number          // 现金变化
 *     daoValue:  Number          // 道义值变化
 *     goodsid:   String          // 货物 resId（give_goods 时使用）
 *     listYes:   [OptionObj]     // YES 选项
 *     listNo:    [OptionObj]     // NO 选项
 *   }
 *
 *   选项对象：
 *   {
 *     type:   'lost_goods' | 'give_goods' | 'nothing' | ...
 *     title, story, health, cash, daoValue, goodsid, audioKey
 *   }
 * ============================================================================
 */
(function (global) {
    'use strict';

    var APP = global.HUN_PC || (global.HUN_PC = {});

    // ============================ 事件模板 ============================
    /**
     * 事件模板库。文案取自游戏自身世界观（日本黑道题材），
     * 数值遵循原版量级：health ±5~30，cash ±500~8000，daoValue ±1~3。
     */
    var TEMPLATES = [
        // ---------- 街头冲突 ----------
        {
            id: 'evt_street_fight',
            title: '街头冲突',
            story: '你走在街上，前方几个混混挡住了去路，为首的家伙掂着手里的球棒，冲你抬了抬下巴。$NEW_LINE$"识相的把钱交出来，我们就当没见过你。"',
            audioKey: 'click_in_menu_1',
            yes: { story: '你握紧了拳头冲了上去。', health: -18, cash: 0, daoValue: 1 },
            no: { story: '你掏出一沓钱递过去，对方满意地离开了。', health: 0, cash: -3000, daoValue: -1 }
        },
        {
            id: 'evt_ally_help',
            title: '小弟求救',
            story: '电话在凌晨三点响起，是你手下一个小弟打来的。$NEW_LINE$"大哥……我在外面被人堵了，实在没办法了才找你。"',
            audioKey: 'click_in_menu_1',
            yes: { story: '你带人赶了过去，把小弟捞了出来，自己也挂了彩。', health: -12, cash: 0, daoValue: 2 },
            no: { story: '你挂断了电话。第二天听说他被送进了医院。', health: 0, cash: 0, daoValue: -2 }
        },

        // ---------- 商机 ----------
        {
            id: 'evt_goods_deal',
            title: '来路不明的货',
            story: '一个陌生人凑近你，压低声音说他手上有一批"没有手续"的货，价钱好商量。$NEW_LINE$"兄弟，识货的都知道这是白捡。"',
            audioKey: 'click_in_menu_1',
            yes: { story: '你决定赌一把，把钱递了过去。', health: 0, cash: -5000, daoValue: 1 },
            no: { story: '你摇了摇头。对方耸耸肩走开了。', health: 0, cash: 0, daoValue: 0 }
        },
        {
            id: 'evt_lucky_money',
            title: '路边的皮包',
            story: '你在巷子口踢到一个鼓鼓囊囊的皮包，四下无人。$NEW_LINE$打开一看，里面全是现金。',
            audioKey: 'click_in_menu_1',
            yes: { story: '你把皮包塞进了怀里。', health: 0, cash: 8000, daoValue: -2 },
            no: { story: '你把皮包交给了附近的派出所。', health: 0, cash: 0, daoValue: 2 }
        },

        // ---------- 情义 ----------
        {
            id: 'evt_old_boss',
            title: '昔日的老大',
            story: '在一家居酒屋，你碰到了当年的老大。他已经不再风光，一个人喝着闷酒。$NEW_LINE$"小子，混得不错啊。"',
            audioKey: 'click_in_menu_1',
            yes: { story: '你坐下陪他喝到天亮，结账时顺手把单买了。', health: -6, cash: -4000, daoValue: 3 },
            no: { story: '你假装没看见，快步走出门去。', health: 0, cash: 0, daoValue: -2 }
        },
        {
            id: 'evt_woman_plea',
            title: '陌生女子的请求',
            story: '一个神色慌张的女子拦住你，说有人在追她，求你让她躲一躲。$NEW_LINE$远处已经传来了急促的脚步声。',
            audioKey: 'click_in_menu_1',
            yes: { story: '你把她藏进了车里。追赶的人骂骂咧咧地走远了。', health: -8, cash: 0, daoValue: 2 },
            no: { story: '你侧身让开了路，快步离开。', health: 0, cash: 0, daoValue: -1 }
        },

        // ---------- 风险 ----------
        {
            id: 'evt_police_bribe',
            title: '临检',
            story: '一名警察拦下了你的车，绕着车身走了一圈，敲了敲车窗。$NEW_LINE$"这位先生，方便配合一下检查吗？"',
            audioKey: 'click_in_menu_1',
            yes: { story: '你不动声色地递过去一个信封，对方收下后挥手放行。', health: 0, cash: -6000, daoValue: -1 },
            no: { story: '你坚持要求对方出示证件，僵持了半小时才被放走。', health: -10, cash: 0, daoValue: 1 }
        },
        {
            id: 'evt_gambling',
            title: '地下赌局',
            story: '有人邀你去参加一场地下赌局，据说赌注很大。$NEW_LINE$"怎么样，敢不敢玩一把？"',
            audioKey: 'click_in_menu_1',
            yes: { story: '你坐上了赌桌。', health: -5, cash: 12000, daoValue: -1 },
            no: { story: '你对赌博没兴趣，婉拒了对方。', health: 0, cash: 0, daoValue: 0 }
        },

        // ---------- 意外 ----------
        {
            id: 'evt_car_trouble',
            title: '半路抛锚',
            story: '车子在郊外的路上突然熄了火，天色正在暗下来，四周看不到人烟。',
            audioKey: 'click_in_menu_1',
            yes: { story: '你自己动手检修，折腾了几个小时终于重新发动。', health: -14, cash: -1500, daoValue: 0 },
            no: { story: '你花大价钱叫了拖车和修理工。', health: 0, cash: -7000, daoValue: 0 }
        },
        {
            id: 'evt_sick',
            title: '身体不适',
            story: '连续几天没合眼，你感觉头重脚轻，额头发烫。',
            audioKey: 'click_in_menu_1',
            yes: { story: '你去了医院，医生让你住院观察两天。', health: 22, cash: -5000, daoValue: 0 },
            no: { story: '你咬牙硬撑着继续赶路。', health: -16, cash: 0, daoValue: 0 }
        },

        // ---------- 货物 ----------
        {
            id: 'evt_lost_goods',
            title: '货物不见了',
            story: '你回到车上，发现后座的箱子被撬开了，里面的东西少了一部分。',
            audioKey: 'click_in_menu_1',
            type: 'lost_goods',
            yes: { story: '你捏着拳头，把这笔账记在了心里。', health: -5, cash: 0, daoValue: 0 },
            no: { story: '你决定先离开这里再说。', health: 0, cash: 0, daoValue: 0 }
        }
    ];

    // ============================ 引擎 ============================
    var EventEngine = {
        _pool: [],
        _recent: [],
        MAX_RECENT: 5,
        _gameData: null,
        _goodsResIds: [],
        _voicePool: [],

        /** 初始化：从规则库抽取可用货物等上下文 */
        init: function (gameData) {
            this._gameData = gameData || null;
            this._pool = TEMPLATES.slice();
            this._recent = [];

            // 收集可用货物 resId（供 give_goods 事件使用）
            this._goodsResIds = [];
            try {
                var g = gameData && gameData.Root && gameData.Root.goods;
                var arr = (g && (g.goods || g.goods_model)) || [];
                for (var i = 0; i < arr.length; i++) {
                    var it = arr[i];
                    if (it && (it.resId || it.id)) {
                        this._goodsResIds.push(it.resId || it.id);
                    }
                }
            } catch (e) { }

            console.log('[事件引擎] 初始化，模板', this._pool.length,
                '个，可用货品', this._goodsResIds.length, '种');
        },

        /** 取下一个事件（返回符合契约的 EventObj，或 null） */
        next: function () {
            if (!this._pool.length) return null;

            // 去重挑模板
            var tpl = null;
            for (var i = 0; i < 12; i++) {
                var c = this._pool[Math.floor(Math.random() * this._pool.length)];
                if (this._recent.indexOf(c.id) < 0) { tpl = c; break; }
            }
            if (!tpl) tpl = this._pool[Math.floor(Math.random() * this._pool.length)];

            this._recent.push(tpl.id);
            if (this._recent.length > this.MAX_RECENT) this._recent.shift();

            return this._build(tpl);
        },

        /** 把模板实例化为事件对象（数值带随机浮动，贴近原版体感） */
        _build: function (tpl) {
            var self = this;

            function jitter(v, ratio) {
                if (!v) return v;
                var r = ratio == null ? 0.25 : ratio;
                var d = v * r;
                var n = v + (Math.random() * 2 - 1) * d;
                return Math.round(n / 10) * 10;
            }

            function mkOption(o, fallbackStory) {
                var opt = {
                    type: o.type || tpl.type || 'nothing',
                    title: tpl.title,
                    story: o.story || fallbackStory || '',
                    health: jitter(o.health || 0),
                    cash: jitter(o.cash || 0),
                    daoValue: o.daoValue || 0,
                    audioKey: tpl.audioKey || 'click_in_menu_1'
                };
                if (opt.type === 'give_goods' && self._goodsResIds.length) {
                    opt.goodsid = self._goodsResIds[
                        Math.floor(Math.random() * self._goodsResIds.length)];
                }
                return opt;
            }

            var yes = mkOption(tpl.yes, tpl.yes && tpl.yes.story);
            var no = mkOption(tpl.no, tpl.no && tpl.no.story);

            var evt = {
                type: tpl.type === 'interaction' || !tpl.type ? 'interaction' : tpl.type,
                title: tpl.title,
                story: tpl.story,
                audioKey: tpl.audioKey || 'click_in_menu_1',
                health: 0,
                cash: 0,
                daoValue: 0,
                listYes: [yes],
                listNo: [no]
            };

            // 非交互型事件（lost_goods / give_goods）直接使用选项效果
            if (evt.type !== 'interaction') {
                evt.health = yes.health;
                evt.cash = yes.cash;
                evt.daoValue = yes.daoValue;
                if (yes.goodsid) evt.goodsid = yes.goodsid;
            }

            return evt;
        },

        /** 供 UI 展示的概率信息（可选） */
        size: function () { return this._pool.length; }
    };

    APP.EventEngine = EventEngine;
    global.HUN_PC.EventEngine = EventEngine;

    console.log('[事件引擎] 已加载，模板', TEMPLATES.length, '个');
})(typeof window !== 'undefined' ? window : this);
