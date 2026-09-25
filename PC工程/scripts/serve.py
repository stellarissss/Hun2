#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地静态服务器 + 外网拦截记录，用于验证离线版是否真的零外网请求。
"""
import http.server, socketserver, os, sys, threading, json, time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "www")
ROOT = os.path.abspath(ROOT)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8100

LOG = []
LOCK = threading.Lock()

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
    ".ogg": "audio/ogg", ".svg": "image/svg+xml", ".woff": "font/woff",
    ".woff2": "font/woff2", ".ttf": "font/ttf",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        with LOCK:
            LOG.append(self.path)

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return MIME.get(ext, "application/octet-stream")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    os.chdir(ROOT)
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print(f"服务目录: {ROOT}")
        print(f"访问地址: http://localhost:{PORT}/index.html")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")
