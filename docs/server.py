#!/usr/bin/env python3
"""Site editor: point-and-click editing of a static (Weebly-exported) website.

Start it with:

    python3 /Volumes/ProjectData/OFF-GRID/Site-Editor/docs/server.py

(Without Python: open the editor in Chrome/Edge from GitHub Pages and choose the
website folder. Both ways edit the same files.)

It finds the site in ../../Terramadas/website/docs. To edit another site,
give its folder:  python3 server.py /path/to/site/docs

Your browser opens the editor. Changes are saved straight into the site folder.
Every save first copies the previous version of the page to editor-backups/
next to the site folder, so nothing is ever lost. Stop with Ctrl+C.

Only Python's standard library is used (no pip install needed). The editor
only accepts connections from this computer.
"""
import json
import mimetypes
import os
import re
import shutil
import sys
import threading
import time
import webbrowser
from html import escape, unescape
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

PORT = int(os.environ.get('EDITOR_PORT', '8765'))
HERE = Path(__file__).resolve().parent


def find_site():
    """The site folder: given on the command line, or found next to the editor."""
    if len(sys.argv) > 1:
        return Path(sys.argv[1]).expanduser().resolve()
    for cand in (HERE.parents[1] / 'Terramadas' / 'website' / 'docs',   # Site-Editor/docs -> ../../Terramadas/website/docs
                 HERE.parents[1] / 'docs'):                              # website/tools/editor -> website/docs
        if (cand / 'index.html').exists():
            return cand.resolve()
    return HERE.parents[1] / 'Terramadas' / 'website' / 'docs'


DOCS = find_site()
BACKUPS = DOCS.parent / 'editor-backups'   # next to the site, never inside it
# folders the editor uses next to the site (never published)
AREAS = {'site': DOCS, 'originals': DOCS.parent / 'image-originals', 'unused': DOCS.parent / 'unused-files'}


def area_path(area, rel):
    base = AREAS.get(area)
    if base is None:
        raise ValueError('bad area')
    parts = [x for x in str(rel).replace('\\', '/').split('/') if x and x != '.']
    if not parts or '..' in parts or any(x.startswith('._') for x in parts):
        raise ValueError('bad path')
    return base.joinpath(*parts)


def list_area(area):
    base = AREAS[area]
    out = []
    if base.is_dir():
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if f.startswith('._') or f == '.DS_Store' or f.startswith('.tmp-'):
                    continue
                full = Path(root) / f
                out.append({'path': full.relative_to(base).as_posix(), 'size': full.stat().st_size})
    return out
PAGE_RE = re.compile(r'^[a-z0-9][a-z0-9-]*\.html$')
UL_RE = re.compile(r'(<ul class="wsite-menu-default">)(.*?)(</ul>)', re.S)
SE_UL_RE = re.compile(r'(<ul\b[^>]*\bdata-se="menu"[^>]*>)(.*?)(\n?[ \t]*</ul>)', re.S)
FLYOUT_RE = re.compile(r'(initPublishedFlyoutMenus\(\s*)(\[.*?\])(\s*,\s*)"([^"]*)"', re.S)


def pages():
    return sorted(p.name for p in DOCS.glob('*.html') if not p.name.startswith('._'))


def read(path):
    return path.read_text(encoding='utf-8')


def backup(path, label=''):
    if not path.exists():
        return
    day = time.strftime('%Y-%m-%d')
    dest = BACKUPS / day
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dest / ('%s%s-%s' % (time.strftime('%H%M%S'), label, path.name)))


def write_atomic(path, text):
    tmp = path.with_name('.tmp-' + path.name)
    tmp.write_text(text, encoding='utf-8')
    os.replace(tmp, path)


class _ScriptTags(HTMLParser):
    """Finds real <script> start tags (not '<script' text inside JavaScript)."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.found = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.found.append((self.getpos(), self.get_starttag_text()))


def inert_scripts(html):
    """Scripts must not run while editing (they'd change the page). Mark them
    inert; the editor restores the original type when it saves."""
    finder = _ScriptTags()
    finder.feed(html)
    finder.close()
    # HTMLParser counts lines by '\n' only
    starts = [0] + [m.end() for m in re.finditer('\n', html)]
    out, last = [], 0
    for (line, col), raw in finder.found:
        pos = starts[line - 1] + col
        if html[pos:pos + len(raw)] != raw or 'data-ed-type' in raw:
            continue
        attrs = raw[len('<script'):-1]
        tm = re.search(r'\stype\s*=\s*(["\'])(.*?)\1', attrs, re.I)
        orig = ''
        if tm:
            orig = tm.group(2)
            attrs = attrs[:tm.start()] + attrs[tm.end():]
        out.append(html[last:pos])
        out.append('<script data-ed-type="%s" type="text/x-inert"%s>' % (escape(orig, quote=True), attrs))
        last = pos + len(raw)
    out.append(html[last:])
    # while editing nothing is fetched from other websites (fonts, scripts, trackers…)
    return re.sub(r'<head\b[^>]*>', lambda m: m.group(0) + EDIT_POLICY, ''.join(out), count=1, flags=re.I)


EDIT_POLICY = '''<meta http-equiv="Content-Security-Policy" content="default-src 'self' blob: data:; style-src 'self' blob: data: 'unsafe-inline'; script-src 'none'; frame-src 'none'; form-action 'none'" data-editor="1">'''


# ---------- navigation menu (repeated in every page) ----------

def read_menu():
    html = read(DOCS / 'index.html')
    m = FLYOUT_RE.search(html)
    if m:
        return [{'id': str(i.get('id', '')), 'title': i.get('title', ''), 'url': i.get('url', ''),
                 'target': i.get('target', '')} for i in json.loads(m.group(2))]
    items = []
    se = SE_UL_RE.search(html)
    if se:   # a site made from a template
        for li in re.finditer(r'<li\b[^>]*>\s*<a\b([^>]*)>(.*?)</a>', se.group(2), re.S):
            href = re.search(r'\bhref="([^"]*)"', li.group(1))
            tgt = re.search(r'\btarget="([^"]*)"', li.group(1))
            items.append({'id': '', 'title': unescape(re.sub(r'<[^>]+>', '', li.group(2))).strip(),
                          'url': unescape(href.group(1)) if href else '', 'target': tgt.group(1) if tgt else ''})
        return items
    um = UL_RE.search(html)
    for li in re.finditer(r'<li[^>]*?(?:id="pg(\d+)")?[^>]*>.*?href="([^"]*)".*?>\s*(.*?)\s*</a>', um.group(2) if um else '', re.S):
        items.append({'id': li.group(1) or '', 'title': re.sub(r'<[^>]+>', '', li.group(3)).strip(),
                      'url': li.group(2), 'target': ''})
    return items


def menu_li(item, active):
    target = '\n\t\ttarget="%s"' % escape(item['target']) if item.get('target') else ''
    return ('<li id="%s" class="wsite-menu-item-wrap">\n\t<a\n\t\thref="%s"%s\n\t\tclass="wsite-menu-item"\n\t\t>\n'
            '\t\t%s\n\t</a>\n\t\n</li>' % ('active' if active else 'pg' + item['id'], escape(item['url']),
                                           target, escape(item['title'])))


def apply_menu(html, items, page):
    def se_ul(m):
        ind = re.search(r'\n([ \t]*)<li', m.group(2))
        ind = ind.group(1) if ind else '\t\t\t\t\t'
        lis = '\n'.join('%s<li%s><a href="%s"%s>%s</a></li>' % (
            ind, ' class="active"' if i['url'] == page else '', escape(i['url']),
            ' target="%s"' % escape(i['target']) if i.get('target') else '', escape(i['title'])) for i in items)
        return m.group(1) + '\n' + lis + m.group(3)
    html = SE_UL_RE.sub(se_ul, html)

    def ul(m):
        if '<ul' in m.group(2):
            raise ValueError('sub-menus are not supported')
        lis = '\n'.join(menu_li(i, i['url'] == page) for i in items)
        return m.group(1) + '\n' + lis + '\n' + m.group(3)
    html = UL_RE.sub(ul, html)
    current = next((i['id'] for i in items if i['url'] == page), '')
    data = [{'id': i['id'], 'title': i['title'], 'url': i['url'], 'target': i.get('target', ''),
             'nav_menu': False, 'nonclickable': False} for i in items]

    def fly(m):
        return m.group(1) + json.dumps(data, ensure_ascii=False) + m.group(3) + '"%s"' % current
    return FLYOUT_RE.sub(fly, html)


def save_menu(items):
    clean = []
    for i in items:
        item = {'id': re.sub(r'\D', '', str(i.get('id', ''))) or str(int(time.time() * 1000)) + '%04d' % len(clean),
                'title': str(i.get('title', '')).strip() or 'Page',
                'url': str(i.get('url', '')).strip(), 'target': '_blank' if i.get('target') else ''}
        if item['url']:
            clean.append(item)
    for name in pages():
        path = DOCS / name
        old = read(path)
        new = apply_menu(old, clean, name)
        if new != old:
            backup(path, '-menu')
            write_atomic(path, new)
    return clean


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = 'SiteEditor/1'

    def log_message(self, fmt, *args):
        if os.environ.get('EDITOR_VERBOSE'):
            sys.stderr.write('%s\n' % (fmt % args))

    def _allowed(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        return host in ('127.0.0.1', 'localhost')

    def send(self, code, body, ctype='text/plain; charset=utf-8'):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def json(self, obj, code=200):
        self.send(code, json.dumps(obj), 'application/json')

    def static(self, base, rel):
        path = (base / rel).resolve()
        if base.resolve() not in path.parents or not path.is_file():
            return self.send(404, 'Not found')
        ctype = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/javascript', 'application/json'):
            ctype += '; charset=utf-8'
        self.send(200, path.read_bytes(), ctype)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._allowed():
            return self.send(403, 'Forbidden')
        url = urlsplit(self.path)
        path, q = unquote(url.path), parse_qs(url.query)
        if path in ('/', '/index.html'):
            return self.static(HERE, 'index.html')
        if path.startswith('/__editor/'):
            return self.static(HERE, path[len('/__editor/'):])
        if re.match(r'^/(themes/)?[a-z0-9.-]+\.(js|css)$', path) and path != '/sw.js':
            return self.static(HERE, path[1:])
        if path == '/__api/pages':
            out = []
            for name in pages():
                m = re.search(r'<title>(.*?)</title>', read(DOCS / name), re.S)
                out.append({'file': name, 'title': (unescape(m.group(1).strip()) if m else name)})
            return self.json(out)
        if path == '/__api/menu':
            return self.json(read_menu())
        if path == '/__api/files':
            try:
                return self.json(list_area(q.get('area', ['site'])[0]))
            except (KeyError, ValueError):
                return self.json({'error': 'bad area'}, 400)
        if path == '/__api/file':
            try:
                p = area_path(q.get('area', ['site'])[0], q.get('path', [''])[0])
            except ValueError:
                return self.send(400, 'bad path')
            if not p.is_file():
                return self.send(404, 'Not found')
            return self.send(200, p.read_bytes(), mimetypes.guess_type(p.name)[0] or 'application/octet-stream')
        if path.startswith('/site/'):
            rel = path[len('/site/'):] or 'index.html'
            if q.get('edit') and rel.endswith('.html'):
                p = (DOCS / rel).resolve()
                if p.parent != DOCS.resolve() or not p.is_file():
                    return self.send(404, 'Not found')
                return self.send(200, inert_scripts(read(p)), 'text/html; charset=utf-8')
            return self.static(DOCS, rel)
        self.send(404, 'Not found')

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n)

    def do_POST(self):
        # the custom header blocks requests from other websites
        if not self._allowed() or self.headers.get('X-Editor') != '1':
            return self.send(403, 'Forbidden')
        url = urlsplit(self.path)
        q = parse_qs(url.query)
        try:
            if url.path == '/__api/save':
                data = json.loads(self.body())
                page, html = data.get('page', ''), data.get('html', '')
                if not PAGE_RE.match(page) or '<html' not in html.lower():
                    return self.json({'error': 'bad page'}, 400)
                path = DOCS / page
                if data.get('create') and path.exists():
                    return self.json({'error': 'A page called %s already exists.' % page}, 409)
                if not data.get('create') and not path.exists():
                    return self.json({'error': 'page not found'}, 404)
                backup(path)
                write_atomic(path, html)
                return self.json({'ok': True, 'page': page})
            if url.path == '/__api/upload':
                name = q.get('name', ['image'])[0]
                stem, ext = os.path.splitext(os.path.basename(name))
                ext = ext.lower()
                if ext not in ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.pdf'):
                    return self.json({'error': 'Only images (jpg, png, gif, webp, svg) or pdf.'}, 400)
                stem = re.sub(r'[^a-z0-9]+', '-', stem.lower()).strip('-')[:50] or 'image'
                sub = 'downloads' if ext == '.pdf' else 'images/graphics' if ext in ('.png', '.gif', '.svg') else 'images'
                folder = DOCS / sub
                folder.mkdir(parents=True, exist_ok=True)
                fname = '%s-%s%s' % (stem, time.strftime('%Y%m%d-%H%M%S'), ext)
                (folder / fname).write_bytes(self.body())
                return self.json({'path': sub + '/' + fname})
            if url.path == '/__api/menu':
                return self.json(save_menu(json.loads(self.body())))
            if url.path == '/__api/file':
                p = area_path(q.get('area', ['site'])[0], q.get('path', [''])[0])
                p.parent.mkdir(parents=True, exist_ok=True)
                tmp = p.with_name('.tmp-' + p.name)
                tmp.write_bytes(self.body())
                os.replace(tmp, p)
                return self.json({'ok': True})
            if url.path == '/__api/move':
                data = json.loads(self.body())
                src = area_path(data.get('from', ''), data.get('path', ''))
                dst = area_path(data.get('to', ''), data.get('to_path') or data.get('path', ''))
                if data.get('to_path') and dst.exists():
                    return self.json({'error': 'A file with that name already exists.'}, 409)
                if not src.is_file():
                    return self.json({'error': 'not found'}, 404)
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(dst))
                return self.json({'ok': True})
            if url.path == '/__api/delete-page':
                page = json.loads(self.body()).get('page', '')
                if not PAGE_RE.match(page) or page == 'index.html' or not (DOCS / page).exists():
                    return self.json({'error': 'This page cannot be deleted.'}, 400)
                backup(DOCS / page, '-deleted')
                (DOCS / page).unlink()
                save_menu([i for i in read_menu() if i['url'] != page])
                return self.json({'ok': True})
        except (ValueError, KeyError) as e:
            return self.json({'error': str(e)}, 400)
        self.send(404, 'Not found')


def main():
    if not (DOCS / 'index.html').exists():
        sys.exit('Cannot find the site at %s' % DOCS)
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    url = 'http://127.0.0.1:%d/' % PORT
    print('Site editor running at %s' % url)
    print('Editing: %s' % DOCS)
    print('Press Ctrl+C to stop.')
    if not os.environ.get('EDITOR_NO_BROWSER'):
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nEditor stopped.')


if __name__ == '__main__':
    main()
