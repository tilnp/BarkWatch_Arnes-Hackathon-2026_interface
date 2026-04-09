#!/usr/bin/env python3
"""
Simple MBTiles viewer using MapLibre GL JS.
Run with: python3 view_mbtiles.py
Then open http://localhost:8000 in your browser.
"""

import sqlite3
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

MBTILES_FILE = 'odseki_map_vector.mbtiles'
PORT = 8000

import csv
import json
import mimetypes
import re
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / 'static'

# Easy-to-change location and file name for odsek attribute data.
ODSEKI_DATA_DIR = BASE_DIR / "data"
ODSEKI_DATA_FILENAME = 'odseki_processed.csv'
ODSEKI_DATA_PATH = ODSEKI_DATA_DIR / ODSEKI_DATA_FILENAME

# Easy-to-change list of columns shown in the left panel.
ODSEKI_FIELDS = [
    'ggo', 'odsek', 'povrsina', 'relief', 'lega', 'nagib',
    'kamnina', 'kamnit', 'skalnat', 'negovan', 'pompov',
    'lzigl', 'lzlst', 'lzsku', 'etigl', 'etlst', 'etsku'
]

SUGGESTION_LIMIT = 20

ODSEKI_BY_ID = {}
ODSEKI_IDS = []


def _configure_csv_field_limit():
    # Some geometry values are very large; increase CSV parser limit safely.
    limit = sys.maxsize
    while True:
        try:
            csv.field_size_limit(limit)
            break
        except OverflowError:
            limit = limit // 10


def _is_lonlat_bbox(bbox):
    min_x, min_y, max_x, max_y = bbox
    return (
        -180 <= min_x <= 180 and -180 <= max_x <= 180 and
        -90 <= min_y <= 90 and -90 <= max_y <= 90
    )


def _extract_bbox_and_center_from_wkt(geometry_text):
    if not geometry_text:
        return None, None

    nums = [
        float(v)
        for v in re.findall(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', geometry_text)
    ]
    if len(nums) < 4:
        return None, None

    if len(nums) % 2 != 0:
        nums = nums[:-1]
    if len(nums) < 4:
        return None, None

    xs = nums[0::2]
    ys = nums[1::2]
    bbox = [min(xs), min(ys), max(xs), max(ys)]
    center = [(bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0]
    return bbox, center


def _odsek_sort_key(odsek_id):
    try:
        return (0, int(odsek_id))
    except ValueError:
        return (1, odsek_id)


def load_odseki_data():
    global ODSEKI_BY_ID, ODSEKI_IDS

    ODSEKI_BY_ID = {}
    ODSEKI_IDS = []

    _configure_csv_field_limit()

    if not ODSEKI_DATA_PATH.exists():
        print(f"WARNING: Odsek data file not found: {ODSEKI_DATA_PATH}")
        return

    try:
        with ODSEKI_DATA_PATH.open('r', encoding='utf-8-sig', newline='') as csv_file:
            reader = csv.DictReader(csv_file)

            for row in reader:
                odsek_id = (row.get('odsek') or '').strip()
                if not odsek_id:
                    continue

                record = {field: row.get(field, '') for field in ODSEKI_FIELDS}

                bbox, center = _extract_bbox_and_center_from_wkt(record.get('geometry', ''))
                if bbox and _is_lonlat_bbox(bbox):
                    record['bbox'] = bbox
                    record['center'] = center

                ODSEKI_BY_ID[odsek_id] = record

        ODSEKI_IDS = sorted(ODSEKI_BY_ID.keys(), key=_odsek_sort_key)
        print(f"Loaded {len(ODSEKI_IDS)} odseki from {ODSEKI_DATA_PATH.name}")
    except Exception as e:
        print(f"WARNING: Failed to load odseki data from {ODSEKI_DATA_PATH}: {e}")


def _sanitize_static_path(request_path):
    rel = request_path.lstrip('/') or 'index.html'
    full = (STATIC_DIR / rel).resolve()

    static_root = STATIC_DIR.resolve()
    if not str(full).startswith(str(static_root)):
        return None
    return full


class TileHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _send_json(self, status_code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def _serve_static_file(self, request_path):
        full_path = _sanitize_static_path(request_path)
        if full_path is None or not full_path.exists() or not full_path.is_file():
            self.send_response(404)
            self.end_headers()
            return

        mime_type, _ = mimetypes.guess_type(str(full_path))
        if not mime_type:
            mime_type = 'application/octet-stream'

        try:
            with full_path.open('rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', mime_type)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception:
            self.send_response(500)
            self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/odseki/suggest':
            query = parse_qs(parsed.query).get('q', [''])[0].strip().lower()
            if not query:
                suggestions = []
            else:
                suggestions = [
                    odsek_id
                    for odsek_id in ODSEKI_IDS
                    if query in odsek_id.lower()
                ][:SUGGESTION_LIMIT]

            self._send_json(200, {
                'query': query,
                'suggestions': suggestions
            })
            return

        if path.startswith('/api/odseki/'):
            odsek_id = unquote(path[len('/api/odseki/'):]).strip()
            if not odsek_id:
                self._send_json(400, {'error': 'Missing odsek id'})
                return

            record = ODSEKI_BY_ID.get(odsek_id)
            if not record:
                self._send_json(404, {'error': f'Odsek {odsek_id} not found'})
                return

            self._send_json(200, {
                'odsek': odsek_id,
                'columns': ODSEKI_FIELDS,
                'data': record
            })
            return

        if path.startswith('/tiles/'):
            parts = path.strip('/').split('/')
            if len(parts) == 4:
                try:
                    _, z, x, y = parts
                    y_base = y.split('.')[0]  # supports /tiles/z/x/y.pbf
                    z, x, y = int(z), int(x), int(y_base)
                    y_tms = (2 ** z - 1) - y

                    conn = sqlite3.connect(MBTILES_FILE)
                    cursor = conn.cursor()
                    cursor.execute(
                        'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
                        (z, x, y_tms)
                    )
                    row = cursor.fetchone()
                    conn.close()

                    if row:
                        tile_data = row[0]
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/vnd.mapbox-vector-tile')
                        if tile_data[:2] == b'\x1f\x8b':
                            self.send_header('Content-Encoding', 'gzip')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(tile_data)
                    else:
                        self.send_response(204)
                        self.end_headers()
                    return
                except Exception:
                    self.send_response(500)
                    self.end_headers()
                    return

        self._serve_static_file(path)

def main():
    if not os.path.exists(MBTILES_FILE):
        print(f"ERROR: '{MBTILES_FILE}' not found.")
        print("Update the MBTILES_FILE variable at the top of the script.")
        sys.exit(1)

    if not STATIC_DIR.exists():
        print(f"ERROR: static directory not found: {STATIC_DIR}")
        print("Create static/index.html, static/styles.css and static/app.js")
        sys.exit(1)

    load_odseki_data()

    print(f"Serving {MBTILES_FILE}")
    print(f"Serving static files from {STATIC_DIR}")
    print(f"Odseki data file: {ODSEKI_DATA_PATH}")
    print(f"Open http://localhost:{PORT} in your browser")
    print("Press Ctrl+C to stop")

    server = HTTPServer(('localhost', PORT), TileHandler)
    server.serve_forever()

if __name__ == '__main__':
    main()
