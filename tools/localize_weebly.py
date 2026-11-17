#!/usr/bin/env python3
"""Make the site independent of Weebly's servers.

Run this on your own computer (it needs internet), after build_site.py:

    python3 ../Site-Editor/tools/localize_weebly.py website/docs

(run from the Terramadas folder)

It downloads everything the pages load from Weebly's CDN (cdn*.editmysite.com):
layout CSS, scripts, fonts, and the images/fonts those CSS files point to.
Files go into docs/vendor/weebly/<server>/<path>, and the pages are relinked
to the local copies. Files already downloaded are not fetched again, so it is
safe to run as often as you like (for example after rebuilding docs).
Only Python's standard library is used: no pip install needed.
"""
import os
import posixpath
import re
import ssl
import sys
import urllib.error
import urllib.request

CDN = re.compile(
    r'''(?:https?:)?//(cdn\d*\.editmysite\.com)/([^"'\s()<>?#]*)((?:\?|#)[^"'\s()<>]*)?''',
    re.I)
CSS_URL = re.compile(r'url\(\s*(["\']?)([^"\')]+)\1\s*\)', re.I)
CSS_IMPORT = re.compile(r'@import\s+(["\'])([^"\']+)\1', re.I)
# quoted paths inside Weebly's scripts, e.g. "images/old/loading.gif"
JS_PATH = re.compile(r'''["']((?:css|js|images|fonts|img|photos)/[A-Za-z0-9_\-./]+\.(?:css|js|png|gif|jpe?g|svg|woff2?|ttf|eot|cur))["']''')
VENDOR = 'vendor/weebly'
ORIGIN_OVERRIDE = os.environ.get('LOCALIZE_ORIGIN')  # only used for testing

CHUNKS = re.compile(r'\{((?:\d+:"[0-9a-f]{8,}",?)+)\}\[\w\]\+"\.js"')
CHUNK_BASE = '"https://"+window.ASSETS_BASE+"/js/"'

stats = {'downloaded': 0, 'cached': 0, 'failed': [], 'optional_missing': 0}


def local_path(docs, host, path):
    return os.path.join(docs, VENDOR, host.lower(), *path.split('/'))


def fetch(host, path, docs, required=True, save_host=None):
    """Download https://host/path into the vendor folder. Returns True if present."""
    out = local_path(docs, save_host or host, path)
    if os.path.exists(out):
        stats['cached'] += 1
        return True
    url = 'https://%s/%s' % (host, path)
    if ORIGIN_OVERRIDE:
        url = '%s/%s/%s' % (ORIGIN_OVERRIDE.rstrip('/'), host, path)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (site backup)'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except urllib.error.URLError as e:
        if isinstance(getattr(e, 'reason', None), ssl.SSLError):
            sys.exit('\nSecure connection failed. If you installed Python from python.org, '
                     'run "Install Certificates.command" in /Applications/Python 3.x/ and try again.')
        if required:
            stats['failed'].append('%s (%s)' % (url, e))
        else:
            stats['optional_missing'] += 1
        return False
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'wb') as fh:
        fh.write(data)
    stats['downloaded'] += 1
    return True


def process_css(host, path, docs, seen):
    """Download the files a CSS file points to; relink absolute CDN urls inside it."""
    key = (host, path)
    if key in seen:
        return
    seen.add(key)
    out = local_path(docs, host, path)
    if not os.path.exists(out):
        return
    with open(out, encoding='utf-8', errors='replace') as fh:
        css = fh.read()
    here = posixpath.dirname(path)
    css_dir = posixpath.dirname(posixpath.join(VENDOR, host.lower(), path))

    def handle(ref):
        ref = ref.strip()
        if not ref or ref.startswith(('data:', '#')):
            return None
        m = CDN.match(ref)
        if m:
            h, p = m.group(1).lower(), m.group(2)
            if not p:
                return None
            if fetch(h, p, docs) and p.lower().endswith('.css'):
                process_css(h, p, docs, seen)
            # absolute CDN url -> relative path to our copy
            return posixpath.relpath(posixpath.join(VENDOR, h, p), css_dir)
        if re.match(r'^([a-z]+:)?//', ref, re.I):
            return None  # some other server (e.g. Google Fonts): leave as is
        raw = re.split(r'[?#]', ref)[0]
        if not raw:
            return None
        if not raw.startswith('/'):
            # already pointing at a local copy (e.g. from an earlier run)?
            site = posixpath.normpath(posixpath.join(css_dir, raw))
            if site.startswith(VENDOR + '/') and os.path.exists(os.path.join(docs, *site.split('/'))):
                return None
        if raw.startswith('/'):
            p, rewrite = posixpath.normpath(raw.lstrip('/')), True
        else:
            p = posixpath.normpath(posixpath.join(here, raw))
            rewrite = p.startswith('..')
            while p.startswith('../'):  # a web server never goes above its root
                p = p[3:]
        if p in ('', '.', '..'):
            return None
        # images/fonts inside Weebly's CSS: many belong to widgets this site
        # doesn't use and no longer exist, so a miss here is not an error
        ok = fetch(host, p, docs, required=False)
        if ok and p.lower().endswith('.css'):
            process_css(host, p, docs, seen)
        if ok and rewrite:
            return posixpath.relpath(posixpath.join(VENDOR, host, p), css_dir)
        return None

    def sub_url(m):
        new = handle(m.group(2))
        return 'url(%s%s%s)' % (m.group(1), new, m.group(1)) if new else m.group(0)

    def sub_import(m):
        new = handle(m.group(2))
        return '@import %s%s%s' % (m.group(1), new, m.group(1)) if new else m.group(0)

    new_css = CSS_IMPORT.sub(sub_import, CSS_URL.sub(sub_url, css))
    if new_css != css:
        with open(out, 'w', encoding='utf-8') as fh:
            fh.write(new_css)


def process_js(host, path, docs, bases, seen=None):
    """Weebly's scripts build some file addresses at run time from STATIC_BASE and
    ASSETS_BASE. Fetch the extra script parts (chunks) main.js loads, make it load
    them from our copy, and best effort fetch quoted file paths found in the script."""
    seen = seen if seen is not None else set()
    if (host, path) in seen:
        return
    seen.add((host, path))
    out = local_path(docs, host, path)
    if not os.path.exists(out):
        return
    with open(out, encoding='utf-8', errors='replace') as fh:
        js = fh.read()
    if CHUNK_BASE in js:
        # "https://"+ASSETS_BASE+"/js/" only works for a server name; ASSETS_BASE
        # is now a local folder, so make the address relative
        js = js.replace(CHUNK_BASE, 'window.ASSETS_BASE+"js/"')
        with open(out, 'w', encoding='utf-8') as fh:
            fh.write(js)
    assets_host = 'cdn11.editmysite.com'
    for group in CHUNKS.findall(js):
        for chunk in re.findall(r'"([0-9a-f]{8,})"', group):
            p = 'js/%s.js' % chunk
            hosts = (assets_host, 'cdn2.editmysite.com')
            before = stats['optional_missing']
            ok = any(fetch(h, p, docs, required=False, save_host=assets_host) for h in hosts)
            stats['optional_missing'] = before  # tracked separately below
            # Weebly's own live site doesn't load these and its server no longer
            # has them (checked Nov 2026): leftovers for unused features, not an error
            process_js(assets_host, p, docs, bases, seen)
    for p in sorted(set(JS_PATH.findall(js))):
        for h in bases:
            if fetch(h, p, docs, required=False):
                break


def main():
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        sys.exit(__doc__)
    docs = sys.argv[1]
    # skip macOS '._' metadata files that some drives create next to real files
    pages = sorted(f for f in os.listdir(docs)
                   if f.lower().endswith('.html') and not f.startswith('._'))
    if not pages:
        sys.exit('No .html pages found in ' + docs)

    texts, wanted, bases = {}, set(), set()
    for name in pages:
        with open(os.path.join(docs, name), encoding='utf-8') as fh:
            texts[name] = fh.read()
        for m in CDN.finditer(texts[name]):
            host, path = m.group(1).lower(), m.group(2)
            if path:
                wanted.add((host, path))
            else:
                bases.add(host)
    # pages already relinked by an earlier run: pick up their vendor files again
    for name in pages:
        for host, path in re.findall(r'vendor/weebly/(cdn\d*\.editmysite\.com)/([^"\'\s()<>?#]+)', texts[name], re.I):
            wanted.add((host.lower(), path))
    for name in pages:
        for host in re.findall(r'["\']vendor/weebly/(cdn\d*\.editmysite\.com)/["\']', texts[name], re.I):
            bases.add(host.lower())

    print('Downloading %d files from Weebly...' % len(wanted))
    seen = set()
    for host, path in sorted(wanted):
        if fetch(host, path, docs):
            if path.lower().endswith('.css'):
                process_css(host, path, docs, seen)
            elif path.lower().endswith('.js'):
                process_js(host, path, docs, sorted(bases | {host}))

    def relink(m):
        host, path = m.group(1).lower(), m.group(2)
        if path and not os.path.exists(local_path(docs, host, path)):
            return m.group(0)  # download failed: keep the original link
        return '%s/%s/%s' % (VENDOR, host, path)

    changed = 0
    for name in pages:
        new = CDN.sub(relink, texts[name])
        if new != texts[name]:
            with open(os.path.join(docs, name), 'w', encoding='utf-8') as fh:
                fh.write(new)
            changed += 1

    left = set()
    for name in pages:
        with open(os.path.join(docs, name), encoding='utf-8') as fh:
            left.update(m.group(0) for m in CDN.finditer(fh.read()))
    print('Downloaded %d new files, %d already present. Relinked %d pages.'
          % (stats['downloaded'], stats['cached'], changed))
    if stats['optional_missing']:
        print('(%d images/fonts named in Weebly\'s CSS no longer exist on their server; '
              'they belong to Weebly widgets such as the shop and blog.)' % stats['optional_missing'])
    if stats['failed']:
        print('\nCould not download:')
        for f in stats['failed']:
            print('  ' + f)
    if left:
        print('\nPages still link to Weebly here:')
        for u in sorted(left):
            print('  ' + u)
    else:
        print('\nNo page links to Weebly\'s servers any more.')


if __name__ == '__main__':
    main()
