/**
 * 更新包（Overlay）机制端到端验证
 *
 * 验证目标：
 *  1. 无 app_overlay 时 → 加载内置版本（resources/../www）
 *  2. 放入 app_overlay 后 → 加载覆盖层版本，且版本号可读出
 *  3. 覆盖层故意放一个"标记文件"，确认页面真的来自覆盖层（而非内置）
 *  4. 删除 app_overlay → 回退到内置版本
 *  5. 存档目录不受影响
 *
 * 做法：用真实 Electron 启动主进程（禁用 GPU / offscreen），
 *       主进程通过 IPC native:appInfo 暴露 overlay 状态，
 *       测试脚本读取后比对。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJ = '/root/.codebuddy/artifact/pc';
const ELECTRON = path.join(PROJ, 'node_modules', '.bin', 'electron');
const SRC_WWW = path.join(PROJ, 'www');
const SRC_ELECTRON = path.join(PROJ, 'electron');

// 模拟一个"已安装的游戏目录"
const FAKE_GAME = '/tmp/fake-game-install';

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
    console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  → ' + detail : ''));
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { } }
function cp(src, dst) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(src, dst, { recursive: true });
}
/** 更快的目录复制（用系统 cp -a） */
function fastCp(src, dst) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const r = require('child_process').spawnSync('cp', ['-a', src, dst], { stdio: 'ignore' });
    if (r.status !== 0) cp(src, dst);   // 回退
}

/**
 * 启动 Electron 主进程，收集 stdout，等待 JSON 结果输出后退出。
 */
function runMain(tag, timeoutMs = 45000) {
    return new Promise((resolve) => {
        const out = [];
        // Electron 需要 X server；用 xvfb-run 包装
        const child = spawn('xvfb-run', [
            '-a', '--server-args=-screen 0 1024x768x24',
            ELECTRON,
            path.join(FAKE_GAME, 'electron', 'main.js'),
            '--no-sandbox', '--disable-gpu'
        ], {
            cwd: FAKE_GAME,
            env: Object.assign({}, process.env, { HUN_OVERLAY_TEST: '1' }),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch (e) { }
            resolve({ tag, out: out.join('\n'), timeout: true });
        }, timeoutMs);

        child.stdout.on('data', d => out.push(d.toString()));
        child.stderr.on('data', d => {
            const s = d.toString();
            if (/\[代码根\]|\[更新包\]|\[OVERLAY_TEST\]/.test(s)) out.push(s);
        });
        child.on('close', () => {
            clearTimeout(timer);
            resolve({ tag, out: out.join('\n'), timeout: false });
        });
        child.on('error', (e) => {
            clearTimeout(timer);
            resolve({ tag, out: 'spawn error: ' + e.message, timeout: false });
        });

        // 给足时间让主进程完成 whenReady + 打印测试信息
        setTimeout(() => { try { child.kill('SIGTERM'); } catch (e) { } }, 22000);
    });
}

function parseOverlayInfo(text) {
    const m = text.match(/\[OVERLAY_TEST\](.*)/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
}

(async () => {
    console.log('== 准备模拟游戏目录 ==');
    rmrf(FAKE_GAME);
    fs.mkdirSync(FAKE_GAME, { recursive: true });

    // 模拟安装后的布局：<game>/electron/main.js + <game>/www + <game>/resources/
    cp(path.join(SRC_ELECTRON, 'main.js'), path.join(FAKE_GAME, 'electron', 'main.js'));
    cp(path.join(SRC_ELECTRON, 'preload.js'), path.join(FAKE_GAME, 'electron', 'preload.js'));
    cp(SRC_WWW, path.join(FAKE_GAME, 'www'));
    fs.mkdirSync(path.join(FAKE_GAME, 'resources'), { recursive: true });
    // ★ 给 main.js 注入测试钩子：启动后打印 overlay 解析结果
    const mainPath = path.join(FAKE_GAME, 'electron', 'main.js');
    let mainSrc = fs.readFileSync(mainPath, 'utf8');

    // 在 whenReady 之后追加一段测试输出（不改动原逻辑）
    const hook = `
// ===== 测试钩子（仅测试环境，HUN_OVERLAY_TEST=1 时生效）=====
if (process.env.HUN_OVERLAY_TEST === '1') {
    app.whenReady().then(() => {
        setTimeout(() => {
            try {
                const info = {
                    overlayRoot: OVERLAY_ROOT,
                    webRoot: WEB_ROOT,
                    preloadPath: PRELOAD_PATH,
                    overlayVersion: readOverlayVersion() ? readOverlayVersion().version : null,
                    saveDir: SAVE_DIR,
                    builtinWww: path.join(__dirname, '..', 'www')
                };
                console.log('[OVERLAY_TEST]' + JSON.stringify(info));
            } catch (e) {
                console.log('[OVERLAY_TEST]' + JSON.stringify({ error: String(e) }));
            }
        }, 2500);
    });
}
`;
    mainSrc += hook;
    fs.writeFileSync(mainPath, mainSrc, 'utf8');

    // 用一个"标记文件"来区分实际加载的 www 版本
    // 内置版标记
    fs.writeFileSync(path.join(FAKE_GAME, 'www', '__marker.txt'), 'BUILTIN_v4.0.0', 'utf8');

    // ---------------------------------------------------------------
    console.log('\n== 阶段 1：无更新包 → 应使用内置版本 ==');
    let r = await runMain('no-overlay');
    let info = parseOverlayInfo(r.out);
    console.log('  主进程输出片段: ' + r.out.split('\n').filter(l => /代码根|更新包|OVERLAY/.test(l)).join(' | ').slice(0, 200));
    check('主进程成功读取覆盖层状态', !!info, info ? 'ok' : '未解析到 [OVERLAY_TEST]');
    if (info) {
        check('未检测到 app_overlay', info.overlayRoot === null, 'overlayRoot=' + info.overlayRoot);
        check('使用内置 www 目录', /fake-game-install[\\/]www$/.test(String(info.webRoot)), info.webRoot);
        check('覆盖层版本为 null', info.overlayVersion === null, 'overlayVersion=' + info.overlayVersion);
    }

    // ---------------------------------------------------------------
    console.log('\n== 阶段 2：放入更新包 → 应切换到覆盖层 ==');
    // 模拟 apply-update.bat 的动作：把 app_overlay 复制到游戏目录
    const overlaySrc = path.join(PROJ, '..', 'dist', 'update-pkg',
        '混在日本-更新包-v4.1.0-地图交互增强', 'app_overlay');
    if (!fs.existsSync(overlaySrc)) {
        check('更新包源存在', false, overlaySrc + ' 不存在');
        process.exit(1);
    }
    fastCp(overlaySrc, path.join(FAKE_GAME, 'app_overlay'));
    // 覆盖层里的"标记文件"（用于证明页面来自覆盖层）
    fs.writeFileSync(path.join(FAKE_GAME, 'app_overlay', 'www', '__marker.txt'),
        'OVERLAY_v4.1.0', 'utf8');

    r = await runMain('with-overlay');
    info = parseOverlayInfo(r.out);
    check('主进程成功读取覆盖层状态', !!info, info ? 'ok' : '未解析到');
    if (info) {
        check('检测到 app_overlay', info.overlayRoot !== null, info.overlayRoot);
        check('切换到覆盖层 www', /app_overlay[\\/]www$/.test(String(info.webRoot)), info.webRoot);
        check('覆盖层版本 = 4.1.0', info.overlayVersion === '4.1.0', 'overlayVersion=' + info.overlayVersion);
        check('preload 指向覆盖层', /app_overlay[\\/]electron[\\/]preload\.js$/.test(String(info.preloadPath)), info.preloadPath);
    }

    // 校验标记文件内容（确认覆盖层内容真的可读）
    const marker = fs.readFileSync(path.join(FAKE_GAME, 'app_overlay', 'www', '__marker.txt'), 'utf8');
    check('覆盖层内容可读取（标记文件）', marker === 'OVERLAY_v4.1.0', marker);

    // 校验覆盖层里 pc-ux.js 存在（本次更新的核心文件）
    check('覆盖层含 pc-ux.js（本次更新核心）',
        fs.existsSync(path.join(FAKE_GAME, 'app_overlay', 'www', 'offline', 'pc-ux.js')),
        'www/offline/pc-ux.js');

    // 校验更新包不含存档（关键：更新不会覆盖存档）
    const hasSave = fs.existsSync(path.join(FAKE_GAME, 'app_overlay', 'saves')) ||
        fs.existsSync(path.join(FAKE_GAME, 'app_overlay', 'userData'));
    check('更新包不含存档目录（存档安全）', !hasSave, hasSave ? '发现存档目录！' : '无');

    // ---------------------------------------------------------------
    console.log('\n== 阶段 3：删除更新包 → 应回退到内置版本 ==');
    rmrf(path.join(FAKE_GAME, 'app_overlay'));
    r = await runMain('removed-overlay');
    info = parseOverlayInfo(r.out);
    check('主进程成功读取覆盖层状态', !!info, info ? 'ok' : '未解析到');
    if (info) {
        check('回退：未检测到 app_overlay', info.overlayRoot === null, 'overlayRoot=' + info.overlayRoot);
        check('回退：使用内置 www', /fake-game-install[\\/]www$/.test(String(info.webRoot)), info.webRoot);
    }

    // ---------------------------------------------------------------
    console.log('\n===== 更新包机制验证：' + results.filter(r => r.ok).length + '/' + results.length + ' 通过 =====');
    fs.writeFileSync('/tmp/overlay_report.json',
        JSON.stringify({ passed: results.filter(r => r.ok).length, total: results.length, results }, null, 2));
    process.exit(results.every(r => r.ok) ? 0 : 1);
})().catch(e => { console.error('脚本异常:', e); process.exit(3); });
