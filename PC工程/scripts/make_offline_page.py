#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从原始 game_main.html 生成本地离线版 game_main_offline.html。

变换规则（保持 DOM 结构等价，仅改资源引用与启动逻辑）：
  1. 剥离所有 CDN / 远程 <script src>
  2. 剥离未使用的 MessageDOM（游戏核心 0 引用）
  3. 保留页面内联脚本，由 boot.js 覆写资源路径为本地
  4. 注入离线适配层 + 本地启动引导
"""
import re, os

SRC = "/tmp/apk_analysis/game_main.html"
OUT = "/root/.codebuddy/artifact/pc/www/game_main_offline.html"

html = open(SRC, encoding="utf-8", errors="replace").read()
orig_len = len(html)

# ---------- 1. 移除远程 lib 脚本 ----------
html = re.sub(
    r'[ \t]*<script[^>]+src="https?://[^"]*?(?:hun2[^"]*|route\.hun333[^"]*|cdn\.bootcss[^"]*|vjs\.zencdn[^"]*)"[^>]*>\s*</script>[ \t]*\r?\n?',
    '', html)

# ---------- 2. 移除 localhost 调试脚本 ----------
html = re.sub(r'[ \t]*<script[^>]+src="http://localhost[^"]*"[^>]*>\s*</script>[ \t]*\r?\n?', '', html)

# ---------- 3. 移除未使用的 MessageDOM ----------
html = re.sub(r'[ \t]*<script[^>]+src="[^"]*MessageDOM\.js"[^>]*>\s*</script>[ \t]*\r?\n?', '', html)
html = re.sub(r'[ \t]*<link[^>]+href="[^"]*MessageDOM\.css"[^>]*>\s*\r?\n?', '', html)

# ---------- 4. 远程 CSS 移除 ----------
html = re.sub(r'[ \t]*<link[^>]+href="https?://[^"]*"[^>]*>\s*\r?\n?', '', html)

# ---------- 4b. D1 裁剪：移除「兑换码」IAP 对话框 DOM ----------
# redeem_code_container_outer 是内购时代的兑换码 UI，
# 游戏核心 hun_min.js 对此 DOM 的引用数为 0（已逐 id 校验）。
# 按 D1「删除内购系统」的决策整块移除；
# 同时消除其引用的 pics/close.png（全 CDN 已 404，属废弃资源）。
_rb = re.search(r'<div\s+id="redeem_code_container_outer"', html)
if _rb:
    # 从该 div 起做标签配对，找到块尾
    _i = _rb.start()
    _j = html.find('>', _i) + 1
    _depth = 1
    _tag = re.compile(r'<(/?)div\b[^>]*?(/?)>', re.I)
    while _depth > 0:
        _m = _tag.search(html, _j)
        if not _m:
            break
        if _m.group(2) == '/':          # 自闭合 <div/>
            pass
        elif _m.group(1) == '/':
            _depth -= 1
        else:
            _depth += 1
        _j = _m.end()
    html = html[:_i] + '<!-- 离线版：兑换码（IAP）对话框已按裁剪策略移除 -->\n' + html[_j:]
    print("  D1 裁剪：兑换码 IAP 对话框已移除")
else:
    print("  D1 裁剪：未找到兑换码对话框（可能已移除）")

# ---------- 5. 本地路径修正 ----------
html = html.replace('href="../css/', 'href="css/')
html = html.replace('src="../js/', 'src="js/')
html = html.replace('src="/static/pics/', 'src="pics/')

# ---------- 5b. 提前挂载路径函数桩（关键）----------
# 页面内联脚本在 <head> 中就用 getResPath_CORS_Web() 计算
# path_static_Javascript 等常量；若等到 boot.js（原在 </head> 前）执行就已太晚。
# 因此必须在 <head> 最前面预置可被"替换赋值"的全局函数桩，
# 使内联脚本定义时即被覆盖，常量计算随即落到本地路径。
EARLY_PATH_STUB = """<script>
/* ===== 离线版：资源路径函数桩（必须早于页面内联脚本）===== */
(function(g){
    g.__HUN_OFFLINE__ = true;
    var LOCAL = ".";
    g.getResPath_CORS_Web   = function(){ return LOCAL; };
    g.getResPath_UNCORS_Web = function(){ return LOCAL; };
    g.getResPath_By_CDN     = function(){ return LOCAL; };
    g.getVersionInfo        = function(){ return "json/version.json"; };
    g.hasGameEnv_Dev        = function(){ return false; };
    try { if (!g.channel) g.channel = "pc"; } catch(e){}
})(window);
</script>
"""

# 定位 <head> 之后第一个 <script 之前插入；若无脚本则插在 <head> 之后
_m = re.search(r'<head[^>]*>', html, re.I)
if _m:
    _pos = _m.end()
    _next = html.find('<script', _pos)
    # 跳过注释块中的 script（原页面 24-60 行均为注释）
    html = html[:_pos] + "\n" + EARLY_PATH_STUB + html[_pos:]

# ---------- 5c. 移除内联脚本中"重新定义"资源路径的原版代码块 ----------
# 原版内联脚本会重新定义 getResPath_CORS_Web / getVersionInfo 等，
# 把上面的桩覆盖回远程地址。这里把函数体改为返回本地根。
def _neutralize(fn_name, html_text):
    """把 function fn_name(){...} 的函数体替换为 return ".";"""
    pat = re.compile(r'(function\s+' + fn_name + r'\s*\(\s*\)\s*\{)')
    m = pat.search(html_text)
    if not m:
        return html_text, False
    start = m.end()
    depth = 1
    i = start
    while i < len(html_text) and depth > 0:
        c = html_text[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        i += 1
    return html_text[:start] + '\n\t\t\t/* 离线版：路径已本地化 */\n\t\t\treturn ".";\n\t\t' + html_text[i - 1:], True

for _fn in ("getResPath_CORS_Web", "getResPath_UNCORS_Web", "getResPath_By_CDN"):
    html, _ok = _neutralize(_fn, html)
    print("  路径函数本地化 %-22s %s" % (_fn, "OK" if _ok else "未找到"))

# getVersionInfo 返回本地 json 路径
_vp = re.compile(r'(function\s+getVersionInfo\s*\(\s*\)\s*\{)')
if _vp.search(html):
    html = _vp.sub(r'\1\n\t\t\t/* 离线版：版本信息走本地 */\n\t\t\treturn "json/version.json";', html, count=1)
    print("  路径函数本地化 getVersionInfo           OK")

# hasGameEnv_Dev 恒为 false
_hp = re.compile(r'(function\s+hasGameEnv_Dev\s*\(\s*\)\s*\{)')
if _hp.search(html):
    html = _hp.sub(r'\1\n\t\t\t/* 离线版：恒为非开发环境 */\n\t\t\treturn false;', html, count=1)
    print("  环境判定本地化 hasGameEnv_Dev          OK")

# ---------- 6. 注入本地路径覆写占位 + 早期引导（位于 </head> 前，兜底）----------
LOCAL_PATH_OVERRIDE = """
<!-- ===== 离线版：本地依赖库（jQuery 须最先，页面内联脚本依赖 $）===== -->
<script src="js/lib/jquery.min.js"></script>
<script src="offline/boot.js"></script>
<script>
/* ===== 离线版：兜底路径覆写（主逻辑已在 <head> 首部与内联脚本中完成）===== */
window.__HUN_OFFLINE__ = true;
window.__applyLocalPaths = function(){
    try{
        if (typeof getResPath_CORS_Web === 'function') getResPath_CORS_Web = function(){ return "."; };
        if (typeof getResPath_UNCORS_Web === 'function') getResPath_UNCORS_Web = function(){ return "."; };
        if (typeof getResPath_By_CDN === 'function') getResPath_By_CDN = function(){ return "."; };
        if (typeof getVersionInfo === 'function') getVersionInfo = function(){ return "json/version.json"; };
    }catch(e){ console.warn('[离线版] 路径覆写异常', e); }
    window.__pathsApplied = true;
};
</script>
"""
html = html.replace('</head>', LOCAL_PATH_OVERRIDE + '</head>', 1)

# ---------- 7. 注入其余本地依赖库 ----------
LOCAL_LIBS = """
<!-- ===== 离线版：其余本地依赖库 ===== -->
<script src="js/lib/crypto-js.js"></script>
<script src="js/lib/LAB.min.js"></script>
<script src="js/lib/howler.core.min.js"></script>
<script src="js/lib/pako.min.js"></script>
<script src="js/lib/pathfinding/pathfinding-browser.min.js"></script>
<!-- ===== 离线适配层（须在 hun_min.js 之前）===== -->
<script src="offline/offline.js"></script>
<script src="offline/native-bridge.js"></script>
<script src="offline/event-engine.js"></script>
<script src="offline/load-order.js"></script>
"""
html = re.sub(r'(<body[^>]*>)', lambda m: m.group(1) + "\n" + LOCAL_LIBS, html, count=1)

# ---------- 8. 注入模块裁剪器与启动引导 ----------
LOCAL_INIT = """
<!-- ===== 离线版：模块裁剪器（须在 hun_min.js 之后）===== -->
<script src="offline/module-cutter.js"></script>
<!-- ===== 离线版：启动引导 ===== -->
<script src="offline/start.js"></script>
"""
html = html.replace('</body>', LOCAL_INIT + '</body>', 1)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)

print("生成: " + OUT)
print("  原始 %d → %d 字符" % (orig_len, len(html)))
print("  脚本引用:")
for m in sorted(set(re.findall(r'<script[^>]+src="([^"]+)"', html))):
    print("    " + m)
print("  样式引用:")
for m in sorted(set(re.findall(r'<link[^>]+href="([^"]+)"', html))):
    print("    " + m)
