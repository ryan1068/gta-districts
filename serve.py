"""本地开发服务器:禁用缓存,保证改完 game.js 刷新就是新的。用法: python3 serve.py [端口]"""
import sys, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8017
ThreadingHTTPServer(('0.0.0.0', port), functools.partial(NoCache, directory='/Users/ryan/3d')).serve_forever()
