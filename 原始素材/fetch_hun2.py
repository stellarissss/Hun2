#!/usr/bin/env python3
# 《混二》APK 分块续传下载器（应对沙盒单连接被掐断 + 签名5分钟过期）
# 用法:
#   python3 fetch_hun2.py "<签名URL>"          # 断点续传（默认）
#   python3 fetch_hun2.py "<签名URL>" --reset  # 从头重新下载
import sys, os, time, urllib.request, urllib.error

OUT   = "/workspace/hun2.apk"
TOTAL = 27816013          # 服务器 Content-Length
BLOCK = 1 * 1024 * 1024   # 每块 1MB，块内遇截断自动续传
UA    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
REF   = "https://www.iefans.net/"

def main():
    if len(sys.argv) < 2:
        print("用法: python3 fetch_hun2.py \"<签名URL>\" [--reset]")
        sys.exit(1)
    url = sys.argv[1]
    if "--reset" in sys.argv and os.path.exists(OUT):
        os.remove(OUT)
    offset = os.path.getsize(OUT) if os.path.exists(OUT) else 0
    print(f"从 {offset}/{TOTAL} 续传 ({100*offset//TOTAL}%)", flush=True)
    with open(OUT, "ab") as f:
        while offset < TOTAL:
            end = min(offset + BLOCK - 1, TOTAL - 1)
            pos = offset
            attempts = 0
            while pos <= end and attempts < 300:
                attempts += 1
                try:
                    req = urllib.request.Request(url, headers={
                        "Range": f"bytes={pos}-{end}",
                        "User-Agent": UA,
                        "Referer": REF,
                    })
                    data = urllib.request.urlopen(req, timeout=60).read()
                    if not data:
                        time.sleep(0.3); continue
                    f.write(data); f.flush()
                    pos += len(data)
                except urllib.error.HTTPError as e:
                    if e.code in (403, 410):
                        print(f"[停止] 签名链接已过期，停在 offset={offset} (HTTP {e.code})。请换新链接续传。", flush=True)
                        return
                    time.sleep(0.3)
                except Exception:
                    time.sleep(0.3)
            if pos <= offset:
                print(f"[停止] offset={offset} 处卡住，需换新签名链接续传。", flush=True)
                return
            offset = pos
            print(f"进度 {offset}/{TOTAL} ({100*offset//TOTAL}%)", flush=True)
    print("下载完成 ✅", flush=True)

if __name__ == "__main__":
    main()
