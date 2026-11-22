from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse


class Handler(BaseHTTPRequestHandler):
    def _send_text(self, status_code: int, body: str) -> None:
        encoded = body.encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query, keep_blank_values=True)

        if path == "/":
            self._send_text(200, "OK")
        elif path == "/ping":
            self._send_text(200, "pong")
        elif path == "/echo":
            msg_values = query.get("msg")
            if not msg_values or msg_values[0] == "":
                self._send_text(400, "Missing msg parameter")
            else:
                # parse_qs already URL-decodes %20 and '+' into spaces
                self._send_text(200, msg_values[0])
        else:
            self._send_text(404, "Not Found")


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8081), Handler).serve_forever()