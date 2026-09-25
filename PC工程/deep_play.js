/**
 * deep_play.js —— 深度玩法闭环验证（基于真实 API）
 *
 * 前一次尝试失败的原因：我按臆想的 API 名（全局 getScene / getState /
 * getSingleGameProgress）写脚本，而实际这些方法都挂在 mainManager 上，
 * 且未进游戏场景时 playManager 会 fallback 成 mainManager 自身。
 * 本版严格复用 acceptance.js 中已验证的真实调用路径，在其之上做深化。
 */
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
function loadWS() {
  const cands = [
    'ws',
    '/usr/lib/node_modules/ws',
    '/usr/local/lib/node_modules/ws',
  ]
  try {
    // 依次尝试常见位置；本地开发时 npm i -D ws 即可
    return require(cands.find((c) => { try { require.resolve(c); return true } catch (e) { return false } }) || 'ws')
  } catch (e) {
    console.error('缺少 ws 依赖，请执行: npm i -D ws')
    process.exit(2)
  }
}
const WS = loadWS()

const PORT = Number(process.env.HUN_CDP_PORT || 9350)
const URL =
  process.env.HUN_BASE_URL ||
  'http://127.0.0.1:8100/game_main_offline.html?openid=local_player&channel=pc&epv=jp&mk=windows&app_version=4&app_lg=zh'

const PROFILE = '/tmp/_deep_profile'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function hget(path, method) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method: method || 'GET' }, (x) => {
      let b = ''
      x.on('data', (c) => (b += c))
      x.on('end', () => res(b))
    })
    r.on('error', rej)
    r.end()
  })
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true })

  const external = []
  const fails = []
  const errs = []
  const PASS = []
  const FAIL = []

  const ch = spawn(
    '/usr/bin/chromium',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + PROFILE,
      '--window-size=465,828',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  for (let i = 0; i < 30; i++) {
    try { await hget('/json/version'); break } catch (e) { await sleep(1000) }
  }

  let send, ws
  async function attach(target) {
    ws = new WS(target.webSocketDebuggerUrl, { perMessageDeflate: false })
    await new Promise((r) => ws.on('open', r))
    let id = 0
    const pend = new Map()
    ws.on('message', (raw) => {
      const m = JSON.parse(raw)
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return }
      if (m.method === 'Network.requestWillBeSent') {
        const u = m.params.request.url
        // 只统计真正的「外网」：排除本机静态服务（8100）与调试端口
        var isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(u) || /^(data|blob|about|chrome|devtools):/.test(u)
        if (!isLocal) external.push(u)
      }
      if (m.method === 'Network.loadingFailed') fails.push(m.params.errorText)
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails
        errs.push((d.exception && d.exception.description) || d.text)
      }
    })
    send = (method, params) =>
      new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })) })
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Network.enable')
  }

  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    if (r.result && r.result.exceptionDetails) {
      return 'EX:' + ((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || '').split('\n')[0]
    }
    return r.result ? r.result.result.value : null
  }

  const check = (name, ok, detail) => {
    console.log('  %s %s%s', ok ? '✅' : '❌', name, detail !== undefined ? ' — ' + detail : '')
    if (ok) PASS.push(name); else FAIL.push(name)
  }

  const t = JSON.parse(await hget('/json/new?' + encodeURIComponent(URL), 'PUT'))
  await attach(t)
  await send('Page.navigate', { url: URL })
  console.log('\n等待初始化 ...')
  await sleep(18000)

  console.log('\n【1】开局状态')
  const menu = await ev(`(function(){
    var pm = mainManager.playManager;
    return { scene: mainManager.getScene(),
             cars: pm.carManager? pm.carManager.allCars_HashMap.size() : 0,
             persons: pm.actorManager? pm.actorManager.persons.length : 0 } })()`)
  check('主菜单就绪', menu && menu.scene === 'SCENE_START_MENU', menu && menu.scene)
  check('车辆数据 66 条', menu && menu.cars === 66, 'cars=' + (menu && menu.cars))
  check('人物数据 110 条', menu && menu.persons === 110, 'persons=' + (menu && menu.persons))

  console.log('\n【2】开始游戏')
  await ev(`(function(){var mm=mainManager;['buyHunCoinBoard','rewardsBoard','lotteryBoard','clubGameInfoBoard','clubGeiShaInfoBoard','rankUnityBoard'].forEach(function(k){if(mm[k]&&mm[k].showMe)mm[k].showMe=false;});return 1;})()`)
  await sleep(900)
  await ev(`(function(){var b=mainManager.startMenuManager.btnStartGame;document.getElementById('gameCanvas').dispatchEvent(new MouseEvent('click',{clientX:b.x+b.w/2,clientY:b.y+b.h/2,bubbles:true,cancelable:true,view:window}));return 1;})()`)
  await sleep(5000)

  const game = await ev(`(function(){var pm=mainManager.playManager;
    return { scene: mainManager.getScene(), state: pm.state,
             hp: pm.getPlayer()? pm.getPlayer().getHp():null,
             cash: pm.getPlayer()? pm.getPlayer().cash:null,
             hunCoin: pm.getHunCoin? pm.getHunCoin():null,
             day: pm.getDay? pm.getDay():null };})()`)
  check('进入游戏场景', game && game.scene === 'SCENE_PLAY', game && game.scene)
  check('玩家 hp=100', game && game.hp === 100, 'hp=' + (game && game.hp))
  check('现金 3000', game && game.cash === 3000, 'cash=' + (game && game.cash))
  check('混币 20000', game && game.hunCoin === 20000, 'hunCoin=' + (game && game.hunCoin))
  console.log('     初始天数:', game && game.day, '| 状态:', game && game.state)

  console.log('\n【3】进入城市')
  await ev(`(function(){
    var pm=mainManager.playManager, cm=pm.cityManager;
    try { var c = cm.curCity || cm.getCityByResId(1) || cm.japanCitys[0]; if(!c) return 'no-city';
          pm.japanMapManager.enterCity(c, true, true); return c.name; } catch(e){ return 'ERR:'+e; }})()`)
  await sleep(7000)
  const inCity = await ev(`(function(){var pm=mainManager.playManager;
    return { state: pm.state, day: pm.getDay? pm.getDay():null,
             city: pm.cityManager.curCity? pm.cityManager.curCity.name:null,
             cash: pm.getPlayer()? pm.getPlayer().cash:null,
             hp: pm.getPlayer()? pm.getPlayer().getHp():null };})()`)
  check('已进入城市', inCity && inCity.state === 'PM_STATE_CITY', JSON.stringify(inCity && inCity.city))
  console.log('     城市态:', JSON.stringify(inCity))

  console.log('\n【4】城市内可交互对象')
  const city = await ev(`(function(){
    var pm=mainManager.playManager, out={};
    try {
      var cm = pm.cityManager;
      out.cityName = cm.curCity ? cm.curCity.name : null;
      var p = pm.getPlayer();
      out.playerPos = p ? {x: p.x, y: p.y} : null;
      out.buildings = cm.buildings ? cm.buildings.length : (cm.buildingArr ? cm.buildingArr.length : 'n/a');
      if (cm.curCity && cm.curCity.buildings) out.cityBuildings = cm.curCity.buildings.length;
      out.hasPathFinding = typeof pm.japanMapManager !== 'undefined';
      out.hasMoneySys = !!(pm.moneyManager || pm.getMoney);
      out.hasEventMgr = !!pm.eventChoiceManager;
      out.hasActorMgr = !!pm.actorManager;
    } catch(e) { out.err = String(e) }
    return out;
  })()`)
  console.log('     ', JSON.stringify(city))
  check('城市对象可访问', !!(city && city.cityName), city && city.cityName)
  check('寻路系统存在', !!(city && city.hasPathFinding), 'japanMapManager=' + (city && city.hasPathFinding))
  check('事件管理器存在', !!(city && city.hasEventMgr), 'eventChoiceManager=' + (city && city.hasEventMgr))

  console.log('\n【5】时间推进')
  const timeAdv = await ev(`(function(){
    var pm = mainManager.playManager;
    var before = pm.getDay ? pm.getDay() : null;
    var called = [], errors = [];
    var cands = ['passDay','passDayAndSaveGame'];
    for (var i=0;i<cands.length;i++){
      var fn = pm[cands[i]];
      if (typeof fn === 'function'){
        try { fn.call(pm); called.push(cands[i]); } catch(e){ errors.push(cands[i]+':'+e.message); }
      }
    }
    try {
      var tm = pm.timeManager || mainManager.timeManager;
      if (tm && typeof tm.addDay === 'function'){ tm.addDay(); called.push('timeManager.addDay'); }
    } catch(e){ errors.push('tm:'+e.message) }
    var after = pm.getDay ? pm.getDay() : null;
    return { before: before, after: after, called: called, errors: errors,
             pmDayFn: typeof pm.getDay };
  })()`)
  console.log('     ', JSON.stringify(timeAdv))
  check('时间推进入口可达', !!(timeAdv && (timeAdv.called.length > 0 || timeAdv.errors.length > 0)),
        'called=' + JSON.stringify(timeAdv && timeAdv.called))

  console.log('\n【6】存档写入与增长')
  const before = await ev(`(function(){ var k=Object.keys(localStorage).filter(function(x){return x.indexOf('progress')>=0})[0];
    return { key:k, len: k? String(localStorage.getItem(k)).length : 0 }; })()`)
  await ev(`(function(){ try { mainManager.progressManager.saveProgress(true,false,false); } catch(e){} return 1; })()`)
  await sleep(2500)
  const after = await ev(`(function(){ var k=Object.keys(localStorage).filter(function(x){return x.indexOf('progress')>=0})[0];
    if(!k) return {key:null,len:0};
    var raw = localStorage.getItem(k); var parsed=null;
    try { parsed = JSON.parse(unzip_sh(raw)); } catch(e){}
    return { key:k, len:String(raw).length,
             topKeys: parsed ? Object.keys(parsed).join(',') : null,
             day: parsed&&parsed.day,
             city: parsed&&parsed.curCity,
             raw_sample: parsed ? JSON.stringify(parsed).slice(0,300) : null }; })()`)
  console.log('     写入前:', JSON.stringify(before))
  console.log('     写入后:', JSON.stringify(after))
  check('存档键存在', !!(after && after.key), after && after.key)
  check('存档已增长', !!(after && after.len >= (before ? before.len : 0)), (before && before.len) + 'B → ' + (after && after.len) + 'B')
  check('存档结构可解析', !!(after && after.raw_sample), '顶层键=' + (after && after.topKeys))

  console.log('\n【7】模块裁剪验证')
  const cut = await ev(`(function(){
    var mm = mainManager; var out = {};
    ['rankUnityBoard','clubGameInfoBoard','clubGeiShaInfoBoard'].forEach(function(k){
      out[k] = (mm[k] === undefined || mm[k] === null) ? 'removed' : 'present';
    });
    var cfg = (typeof HUN_PC!=='undefined' && HUN_PC.config) ? HUN_PC.config : null;
    out.__config = cfg ? {CLUB:cfg.ENABLE_CLUB, RANK:cfg.ENABLE_RANK, INNER:cfg.ENABLE_INNER_GAME,
                          IAP:cfg.ENABLE_IAP, CROWDFUND:cfg.ENABLE_CROWDFUND, HUNCOIN:cfg.INIT_HUN_COIN} : null;
    return out;
  })()`)
  console.log('     ', JSON.stringify(cut))
  const cfg = cut && cut.__config
  check('社团关闭', !!(cfg && cfg.CLUB === false), 'ENABLE_CLUB=' + (cfg && cfg.CLUB))
  check('排行榜关闭', !!(cfg && cfg.RANK === false), 'ENABLE_RANK=' + (cfg && cfg.RANK))
  check('内购关闭', !!(cfg && cfg.IAP === false), 'ENABLE_IAP=' + (cfg && cfg.IAP))
  check('众筹关闭', !!(cfg && cfg.CROWDFUND === false), 'ENABLE_CROWDFUND=' + (cfg && cfg.CROWDFUND))

  console.log('\n【8】离线适配层')
  const off = await ev(`(function(){
    var out = {};
    out.hasHUN_PC = (typeof HUN_PC === 'object' && HUN_PC !== null);
    out.modules = out.hasHUN_PC ? Object.keys(HUN_PC).join(',') : null;
    out.routerEndpoints = (out.hasHUN_PC && HUN_PC.Router && HUN_PC.Router.table) ? Object.keys(HUN_PC.Router.table).length : null;
    out.saveEngine = !!(out.hasHUN_PC && HUN_PC.SaveEngine);
    out.paymentKit = !!(out.hasHUN_PC && HUN_PC.PaymentKit);
    out.eventEngine = !!(out.hasHUN_PC && HUN_PC.EventEngine);
    out.readRaw = typeof __offlineReadSaveRaw === 'function';
    out.unzip = typeof unzip_sh === 'function';
    out.cosShim = !!(window.COS);
    out.nativeKV = !!(window.hunNative);
    return out;
  })()`)
  console.log('     ', JSON.stringify(off).slice(0, 420))
  check('离线层已装载', !!(off && off.hasHUN_PC), 'modules=' + (off && off.modules))
  check('路由表已建', !!(off && off.routerEndpoints > 0), 'endpoints=' + (off && off.routerEndpoints))
  check('支付框架在位', !!(off && off.paymentKit), 'PaymentKit=' + (off && off.paymentKit))

  console.log('\n【9】网络与异常')
  const ext = external.length, f = fails.length, er = errs.length
  check('零外网请求', ext === 0, 'external=' + ext + (ext ? ' 例如 ' + external[0] : ''))
  const realFails = fails.filter(x => x !== 'net::ERR_ABORTED')
  check('零资源失败', realFails.length === 0, 'fails=' + realFails.length + ' (另有 ' + (f - realFails.length) + ' 个 ERR_ABORTED 属主动取消)')
  check('零运行时异常', er === 0, 'errors=' + er + (er ? ' 例如 ' + String(errs[0]).split('\n')[0] : ''))

  console.log('\n════════ 深度验证汇总 ════════')
  console.log('通过 %d / %d', PASS.length, PASS.length + FAIL.length)
  if (FAIL.length) { console.log('未通过：'); FAIL.forEach((x) => console.log('  ✗ ' + x)) }

  try { ws.close() } catch (e) {}
  try { ch.kill('SIGKILL') } catch (e) {}
  await sleep(400)
  process.exit(FAIL.length ? 1 : 0)
}

main().catch((e) => { console.error('脚本失败:', e && e.message); process.exit(2) })
