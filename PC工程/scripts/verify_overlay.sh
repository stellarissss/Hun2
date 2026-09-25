#!/bin/bash
# 更新包机制 — 手动分步验证（最可靠的方式）
set -u

PROJ=/root/.codebuddy/artifact/pc
GAME=/tmp/ov-manual
OVL="/root/.codebuddy/artifact/dist/update-pkg/混在日本-更新包-v4.1.0-地图交互增强/app_overlay"
ELECTRON=$PROJ/node_modules/.bin/electron

rm -rf "$GAME"
mkdir -p "$GAME/electron" "$GAME/resources"

# 1) 铺好"游戏安装目录"
cp -a "$PROJ/electron/main.js"    "$GAME/electron/main.js"
cp -a "$PROJ/electron/preload.js" "$GAME/electron/preload.js"
cp -a "$PROJ/www"                 "$GAME/www"
echo "BUILTIN_v4.0.0" > "$GAME/www/__marker.txt"

# 2) 注入测试钩子（打印 overlay 解析结果）
cat >> "$GAME/electron/main.js" <<'EOF'

// ===== 测试钩子 =====
app.whenReady().then(() => {
    setTimeout(() => {
        try {
            const ov = readOverlayVersion();
            console.log('[OVTEST]' + JSON.stringify({
                overlayRoot: OVERLAY_ROOT,
                webRoot: WEB_ROOT,
                preloadPath: PRELOAD_PATH,
                overlayVersion: ov ? ov.version : null
            }));
            const fs2 = require('fs'), p2 = require('path');
            const mk = p2.join(WEB_ROOT, '__marker.txt');
            console.log('[OVMARK]' + (fs2.existsSync(mk) ? fs2.readFileSync(mk, 'utf8').trim() : 'NO_MARKER'));
            const pux = p2.join(WEB_ROOT, 'offline', 'pc-ux.js');
            console.log('[OVPUX]' + (fs2.existsSync(pux) ? 'PRESENT' : 'MISSING'));
        } catch (e) { console.log('[OVTEST]ERROR:' + e.message); }
    }, 2000);
});
EOF

run_case () {
    local tag="$1"
    local ud="${2:-}"
    [ -z "$ud" ] && ud="/tmp/ov-ud-$(date +%s%N)"
    echo "----------- $tag -----------"
    cd "$GAME"
    timeout 30 xvfb-run -a --server-args="-screen 0 1024x768x24" \
        "$ELECTRON" "$GAME/electron/main.js" --no-sandbox --disable-gpu --user-data-dir="$ud" 2>&1 \
        | grep -E "\[代码根\]|\[更新包\]|\[OVTEST\]|\[OVMARK\]|\[OVPUX\]" \
        | sed 's/^/   /'
}

echo "===== 阶段 1：无更新包 ====="
run_case "无 app_overlay → 期望内置版本"

echo
echo "===== 阶段 2：放入更新包 ====="
cp -a "$OVL" "$GAME/app_overlay"
echo "OVERLAY_v4.1.0" > "$GAME/app_overlay/www/__marker.txt"
run_case "有 app_overlay → 期望覆盖层版本"

echo
echo "===== 阶段 3：删除更新包（回退） ====="
rm -rf "$GAME/app_overlay"
run_case "删除 app_overlay → 期望回退内置版本"

echo
echo "===== 阶段 4：用户数据目录兜底位置 ====="
# 指定 --user-data-dir 时，app.getPath('userData') 即该目录本身
UD="/tmp/ov-ud-fallback"
rm -rf "$UD"; mkdir -p "$UD"
cp -a "$OVL" "$UD/app_overlay"
echo "OVERLAY_USERDATA" > "$UD/app_overlay/www/__marker.txt"
run_case "userData 位置 → 期望被识别" "$UD"
rm -rf "$UD/app_overlay"
