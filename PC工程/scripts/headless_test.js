/**
 * 无头浏览器验证 —— 加载离线版游戏，捕获控制台、异常与全部网络请求。
 * 目标：证明 ① 游戏能跑起来 ② 零外网请求。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const CHROME = '/usr/bin/chromium';
const PORT = 9223;
// 注意：game_main_offline.html 在 openid/channel 缺省时会跳转外站（原版防刷逻辑），
// 因此测试必须带上完整参数。
const URL = process.env.TEST_URL ||
    'http://localhost:8100/game_main_offline.html?openid=local_player&channel=pc&epv=jp&mk=windows&app_version=4&app_lg=zh';
const WAIT_MS = parseInt(process.env.WAIT_MS || '25000', 10);
const OUT = process.argv[2] || '/tmp/headless_report.json';

function httpGet(url, method) {
    return new Promise((res, rej) => {
        const req = http.request(url, { method: method || 'GET' }, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => res(d));
        });
        req.on('error', rej);
        req.end();
    });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const userDir = '/tmp/chrome-prof-' + Date.now();
    const chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
        '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir,
        '--window-size=430,932', '--autoplay-policy=no-user-gesture-required',
        '--disable-extensions', '--no-first-run', '--disable-background-networking',
        '--no-proxy-server', '--proxy-bypass-list=*',
        '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost',
        'about:blank'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
        await sleep(500);
        try {
            const v = await httpGet(`http://127.0.0.1:${PORT}/json/version`);
            if (v && v.indexOf('Browser') >= 0) ready = true;
        } catch (e) { }
    }
    if (!ready) { console.error('CDP 未就绪'); chrome.kill('SIGKILL'); process.exit(1); }

    // 新建页面（新版 Chrome 要求 PUT）
    let target = null;
    try {
        const j = await httpGet(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL)}`, 'PUT');
        target = JSON.parse(j);
    } catch (e) {
        const l = JSON.parse(await httpGet(`http://127.0.0.1:${PORT}/json/list`));
        target = l.find(t => t.type === 'page');
    }
    if (!target || !target.webSocketDebuggerUrl) {
        console.error('未取得页面目标');
        chrome.kill('SIGKILL'); process.exit(1);
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let msgId = 0;
    const pending = new Map();
    const send = (method, params) => new Promise(resolve => {
        const id = ++msgId;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params: params || {} }));
    });

    const consoleLogs = [], network = [], exceptions = [], failed = [], frames = [];

    ws.addEventListener('message', ev => {
        let m; try { m = JSON.parse(ev.data.toString()); } catch (e) { return; }
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }

        switch (m.method) {
            case 'Runtime.consoleAPICalled': {
                const args = (m.params.args || []).map(a =>
                    a.value !== undefined ? String(a.value) : (a.description || a.type));
                consoleLogs.push({ type: m.params.type, text: args.join(' ') });
                break;
            }
            case 'Runtime.exceptionThrown': {
                const d = m.params.exceptionDetails;
                exceptions.push({
                    text: d.text || '',
                    desc: (d.exception && (d.exception.description || d.exception.value)) || '',
                    url: d.url, line: d.lineNumber
                });
                break;
            }
            case 'Network.requestWillBeSent':
                network.push({ url: m.params.request.url, method: m.params.request.method });
                break;
            case 'Network.loadingFailed':
                failed.push({ err: m.params.errorText, type: m.params.type });
                break;
            case 'Page.frameNavigated':
                frames.push(m.params.frame.url);
                break;
        }
    });

    await new Promise(r => ws.addEventListener('open', r));
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Page.enable');

    await send('Page.navigate', { url: URL });
    console.log('导航已发出，等待 ' + (WAIT_MS / 1000) + ' 秒…');
    await sleep(WAIT_MS);

    const PROBE = `(function(){
        var o = {
            href: location.href, title: document.title,
            jq: typeof jQuery, hunpc: typeof window.HUN_PC,
            mm: (typeof window.mainManager !== 'undefined') && !!window.mainManager,
            canvases: document.getElementsByTagName('canvas').length
        };
        try{
            if (window.HUN_PC){
                o.offlineVersion = HUN_PC.version;
                o.router = !!HUN_PC.Router;
                o.saveEngine = !!HUN_PC.SaveEngine;
                o.eventEngine = !!HUN_PC.EventEngine;
                o.eventTemplates = HUN_PC.EventEngine ? HUN_PC.EventEngine.size() : 0;
                o.payKit = !!HUN_PC.PaymentKit;
                if (HUN_PC.config) o.cfg = {
                    club: HUN_PC.config.ENABLE_CLUB, rank: HUN_PC.config.ENABLE_RANK,
                    iap: HUN_PC.config.ENABLE_IAP, coin: HUN_PC.config.INIT_HUN_COIN
                };
            }
            if (window.mainManager){
                o.scene = mainManager.getScene ? mainManager.getScene() : null;
                var pm = mainManager.playManager;
                if (pm){ o.playState = pm.getState ? pm.getState() : null;
                    o.day = pm.getDay ? pm.getDay() : null;
                    o.hunCoin = pm.getHunCoin ? pm.getHunCoin() : null;
                    var p = pm.getPlayer && pm.getPlayer();
                    if (p){ o.hp = p.getHp ? p.getHp() : null; o.cash = p.getCash ? p.getCash() : null; }
                }
            }
            var ld = document.getElementById('loadingDiv');
            o.loadingDisplay = ld ? getComputedStyle(ld).display : 'n/a';
        }catch(e){ o.err = String(e); }
        return o;
    })()`;

    const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    const main = (r && r.exceptionDetails)
        ? { __evalError: r.exceptionDetails.text }
        : (r && r.result ? r.result.value : null);

    const externals = network.filter(n => /^https?:\/\//.test(n.url) &&
        !/localhost:8100|127\.0\.0\.1:8100/.test(n.url));

    const report = {
        navigatedUrl: URL,
        mainFrame: main,
        framesNavigated: Array.from(new Set(frames)),
        consoleCount: consoleLogs.length,
        errors: consoleLogs.filter(c => c.type === 'error'),
        warnings: consoleLogs.filter(c => c.type === 'warning').slice(0, 15),
        offlineLogs: consoleLogs.filter(c => /离线|事件引擎|模块裁剪|原生桥|拦截|HUN_PC/.test(c.text)).slice(0, 50),
        exceptions: exceptions.slice(0, 25),
        networkTotal: network.length,
        loadingFailed: failed.slice(0, 20),
        externalCount: externals.length,
        externalRequests: externals.slice(0, 30)
    };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf-8');

    console.log('\n=============== 验证报告 ===============');
    console.log('主帧状态:');
    console.log(JSON.stringify(report.mainFrame, null, 2));
    console.log('\n控制台消息: ' + report.consoleCount + ' | 错误: ' + report.errors.length +
        ' | 异常: ' + report.exceptions.length);
    console.log('网络请求: ' + report.networkTotal + ' | ★ 外网: ' + report.externalCount + '（应为 0）');
    if (report.externalCount) console.log('  外网: ' + report.externalRequests.map(x => x.url).join(' , '));
    if (report.errors.length) {
        console.log('\n错误明细:');
        report.errors.slice(0, 8).forEach(e => console.log('  ✗ ' + e.text.slice(0, 220)));
    }
    if (report.exceptions.length) {
        console.log('\n异常明细:');
        report.exceptions.slice(0, 8).forEach(e => console.log('  ✗ ' + String(e.desc || e.text).slice(0, 220)));
    }
    console.log('\n离线层日志:');
    report.offlineLogs.slice(0, 20).forEach(l => console.log('  · ' + l.text.slice(0, 160)));

    ws.close();
    chrome.kill('SIGKILL');
    await sleep(400);
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { }
    process.exit(0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
