#!/usr/bin/env python3
"""Rebuild a Weebly archive export as a static site for GitHub Pages.

Usage:  python3 -I build_site.py SOURCE_DIR DEST_DIR

What it fixes (SOURCE_DIR is never modified):
  * Weebly's archive nests some folders one level too deep, so the pages
    point at files that are not where they say:
        files/theme/files/...                  -> files/theme/...
        uploads/.../background-images/background-images/...
                                               -> uploads/.../background-images/...
  * blog.html and stay.html are left out, and Weebly's footer is removed.
  * Weebly's unused customer-accounts script and a duplicate stl.js are removed.
  * macOS junk files (._* and .DS_Store) are left out.
  * /uploads/... paths become uploads/... so the site also works when opened
    from disk or from a GitHub project address, not only from a domain root.
  * Images the pages expect in published/, editor/ or edited/ are pointed at the
    file the archive actually contains (same name, or NAME_orig.ext).
  * http://cdnNN.editmysite.com links become https:// (an https site blocks http scripts/styles).
Then it checks every local reference in every page and CSS file.
"""
import os
import re
import shutil
import sys
from urllib.parse import unquote

SKIP = re.compile(r'^(\._.*|\.DS_Store)$')
# pages that are not part of the new site
SKIP_PAGES = {'blog.html', 'stay.html'}
MOVES = [
    (re.compile(r'^files/theme/files/(.*)$'), r'files/theme/\1'),
    (re.compile(r'^(uploads/.*?/background-images)/background-images/(.*)$'), r'\1/\2'),
]


def map_path(rel):
    for pat, rep in MOVES:
        if pat.match(rel):
            return pat.sub(rep, rel)
    return rel


def copy_tree(src, dst):
    count = 0
    written = set()
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if not SKIP.match(d)]
        for name in files:
            if SKIP.match(name):
                continue
            path = os.path.join(root, name)
            rel = os.path.relpath(path, src).replace(os.sep, '/')
            if rel in SKIP_PAGES:
                continue
            out = os.path.join(dst, map_path(rel))
            if out in written:
                raise SystemExit('Name collision, stopping: ' + out)
            written.add(out)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            shutil.copyfile(path, out)
            count += 1
    return count


UP = re.compile(r'(uploads/[0-9/]+)/(?:published|editor|edited)/([^"\'&)\s?]+)')


def resolve_upload(m, dst):
    """The archive flattens Weebly's published/editor/edited folders into the
    parent folder, and often keeps the file as NAME_orig.ext."""
    base, name = m.group(1), m.group(2)
    stem, ext = os.path.splitext(name)
    for cand in (name, stem + '_orig' + ext):
        if os.path.exists(os.path.join(dst, base, cand)):
            return base + '/' + cand
    return m.group(0)


def drop_unused_scripts(text):
    """Weebly's customer-accounts script (login/shop accounts, not used here) sends a
    failing request to Weebly's server on every page; and stl.js is loaded twice."""
    text = re.sub(r"<script[^>]*main-customer-accounts-site\.js[^>]*>\s*</script>\s*", '', text)
    seen = []
    def once(m):
        seen.append(1)
        return m.group(0) if len(seen) == 1 else ''
    return re.sub(r"<script[^>]*lang/en/stl\.js[^>]*>\s*</script>\s*", once, text)


def fix_html(text, dst):
    text = re.sub(r'http://(cdn\d*\.editmysite\.com)', r'https://\1', text)
    text = re.sub(r'(?<![A-Za-z0-9_.:/-])/uploads/', 'uploads/', text)
    text = UP.sub(lambda m: resolve_upload(m, dst), text)
    # Weebly's 'Create a free web site with Weebly' footer
    text = re.sub(r'\s*<div class="footer-wrap">.*?<!-- end footer-wrap -->', '', text, flags=re.S)
    text = drop_unused_scripts(text)
    # Weebly editor helper that is not part of the export
    text = re.sub(r"<script[^>]*templateArtifacts\.js[^>]*></script>\s*", '', text)
    return text


ATTR = re.compile(r'''\b(?:src|href|poster|data-src)\s*=\s*["']([^"']+)["']''')
URLF = re.compile(r'url\(\s*([^)]+?)\s*\)')


def refs_in(text):
    out = []
    for m in ATTR.finditer(text):
        out.append(m.group(1))
    for m in URLF.finditer(text):
        v = m.group(1).replace('&quot;', '').strip('"\'')
        out.append(v)
    return out


def check(dst):
    missing, external, rootrel = {}, set(), set()
    for root, _, files in os.walk(dst):
        for name in files:
            if not name.lower().endswith(('.html', '.css')):
                continue
            path = os.path.join(root, name)
            with open(path, encoding='utf-8', errors='replace') as fh:
                text = fh.read()
            for ref in refs_in(text):
                if not ref or ref.startswith(('#', 'data:', 'mailto:', 'tel:', 'javascript:')):
                    continue
                if re.match(r'^([a-z][a-z0-9+.-]*:)?//', ref, re.I):
                    external.add(re.sub(r'^(https?:)?//([^/]+).*$', r'\2', ref, flags=re.I))
                    continue
                clean = unquote(re.split(r'[?#]', ref)[0])
                if not clean:
                    continue
                if clean.startswith('/'):
                    rootrel.add(clean)
                    target = os.path.join(dst, clean.lstrip('/'))
                else:
                    target = os.path.normpath(os.path.join(root, clean))
                if not os.path.exists(target):
                    rel = os.path.relpath(path, dst)
                    missing.setdefault(clean, set()).add(rel)
    return missing, external, rootrel


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    src, dst = sys.argv[1], sys.argv[2]
    if not os.path.isdir(src):
        raise SystemExit('Source folder not found: ' + src)
    os.makedirs(dst, exist_ok=True)

    n = copy_tree(src, dst)
    print('Copied %d files (macOS junk skipped, nested folders flattened)' % n)

    changed = 0
    for name in sorted(os.listdir(dst)):
        if name.lower().endswith('.html'):
            p = os.path.join(dst, name)
            with open(p, encoding='utf-8') as fh:
                old = fh.read()
            new = fix_html(old, dst)
            if new != old:
                with open(p, 'w', encoding='utf-8') as fh:
                    fh.write(new)
                changed += 1
    print('Rewrote paths in %d HTML pages' % changed)

    open(os.path.join(dst, '.nojekyll'), 'w').close()

    missing, external, rootrel = check(dst)
    print('\nMISSING local files referenced by pages/CSS: %d' % len(missing))
    for ref in sorted(missing):
        print('  %s   (in %s)' % (ref, ', '.join(sorted(missing[ref]))))
    print('\nRoot-relative references still present (need site at domain root): %d' % len(rootrel))
    for ref in sorted(rootrel)[:20]:
        print('  ' + ref)
    print('\nExternal hosts the site still loads from:')
    for host in sorted(external):
        print('  ' + host)


if __name__ == '__main__':
    main()
