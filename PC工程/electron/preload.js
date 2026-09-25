/**
 * ============================================================================
 * 《混在日本》PC 单机版 · 预加载脚本
 * ============================================================================
 * 把主进程能力以安全方式暴露给渲染进程（contextIsolation = true）。
 *
 * 同时实现原 APK 的 jsbridge_android 兼容层：
 *   游戏核心调用 window.jsbridge_android.callbackJs("cmd&key=value")
 *   本脚本负责解析并转发到主进程，再把结果回灌给从 Android 迁移的回调函数
 *   （fromAndroid_*）。
 * ============================================================================
 */
const { contextBridge, ipcRenderer } = require('electron');

// ============================ 原生能力 ============================
const hunNative = {
    // 存档
    save: (payload) => ipcRenderer.invoke('native:save', payload),
    load: () => ipcRenderer.invoke('native:load'),
    hasSave: () => ipcRenderer.invoke('native:hasSave'),
    clearSave: () => ipcRenderer.invoke('native:clearSave'),
    listSaves: () => ipcRenderer.invoke('native:listSaves'),

    // 设置
    saveSettings: (s) => ipcRenderer.invoke('native:saveSettings', s),
    loadSettings: () => ipcRenderer.invoke('native:loadSettings'),

    // 系统
    sysinfo: () => ipcRenderer.invoke('native:sysinfo'),
    appInfo: () => ipcRenderer.invoke('native:appInfo'),
    openSaveDir: () => ipcRenderer.invoke('native:openSaveDir'),

    // 其它
    outlink: (url) => ipcRenderer.invoke('native:outlink', url),
    pay: (productId) => ipcRenderer.invoke('native:pay', productId),
    toggleFullscreen: () => ipcRenderer.invoke('native:toggleFullscreen'),
    quit: () => ipcRenderer.invoke('native:quit'),

    // 主进程 → 渲染进程事件
    onMenuRestart: (cb) => ipcRenderer.on('menu-restart', () => cb()),

    isElectron: true
};
contextBridge.exposeInMainWorld('hunNative', hunNative);

// ============================ jsbridge_android 兼容层 ============================
/**
 * 原 APK 中 JsToAndroid.callbackJs(String str) 的等价实现。
 * 游戏核心通过 jsbridge_android.callbackJs(...) 调用原生能力。
 *
 * 协议：cmd&key1=value1&key2=value2
 * 常见 cmd：
 *   outlink, googleplay, saveKY, getKY, deleteKY, audiovibrate, base_url,
 *   remove_splash, show_splash, remove_reloadbutton, uuid, getSystemMemory,
 *   checkRoot, getAppMaxMemory, getAppTotalMemory, getAppFreeMemory
 */
contextBridge.exposeInMainWorld('__hunBridge', {
    invoke: (cmdStr) => ipcRenderer.invoke('hun:bridge', String(cmdStr))
});

// 在主世界注入 jsbridge_android（渲染进程脚本可直接调用）
ipcRenderer.on('hun:inject-bridge', () => { /* 由页面脚本自行调用 preload 暴露的方法 */ });
