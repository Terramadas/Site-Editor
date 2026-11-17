#!/usr/bin/env python3
"""Move a site's images out of Weebly's deep uploads/ folders into tidy ones.

Usage (from the Terramadas folder):

    python3 -I ../Site-Editor/tools/reorganise_images.py website/docs --dry-run   # only show the plan
    python3 -I ../Site-Editor/tools/reorganise_images.py website/docs

Every file under uploads/ that a page uses moves to:
    images/               photos and pictures on the pages
    images/backgrounds/   section backgrounds
    images/graphics/      PNG, GIF and SVG pictures (logos, drawings, icons)
    downloads/            other files (PDF…)
File names stay the same (a number is added only if two files would get the same name).
All pages and style sheets are updated, and so is image-originals/ (next to docs): the
originals move along and edits.json follows. Files no page uses are not touched; the
editor's Images panel moves those out of the site.

Before changing anything, the pages, style sheets and edits.json are copied to
editor-backups/<date>/<time>-reorganise/, together with moves.json (every old -> new path).
Afterwards every reference in the site is checked. Only Python's standard library is used.
"""
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import quote, unquote

ATTR = re.compile(r'''(\b(?:src|href|data-src|poster)\s*=\s*)(["'])([^"']*)\2''', re.I)
URLF = re.compile(r'''(url\(\s*)(&quot;|["']?)([^"')&]+?)(\2\s*\))''', re.I)
SKIP = re.compile(r'(^|/)(\._|\.DS_Store$)')
PHOTO = {'.jpg', '.jpeg', '.webp'}
GRAPHIC = {'.png', '.gif', '.svg'}


def resolve(base_dir, ref):
    ref = ref.strip()
    if not ref or re.match(r'^(#|data:|blob:|mailto:|tel:|javascript:|[a-z][a-z0-9+.-]*:|//)', ref, re.I):
        return None, '', ''
    m = re.match(r'^([^?#]*)(.*)$', ref)
    path, tail = m.group(1), m.group(2)
    p = unquote(path)
    parts = [] if p.startswith('/') else [x for x in base_dir.split('/') if x]
    for seg in p.split('/'):
        if seg in ('', '.'):
            continue
        if seg == '..':
            if parts:
                parts.pop()
        else:
            parts.append(seg)
    return '/'.join(parts), tail, path


def relative(from_dir, target):
    a = [x for x in from_dir.split('/') if x]
    b = target.split('/')
    i = 0
    while i < len(a) and i < len(b) - 1 and a[i] == b[i]:
        i += 1
    return '/'.join(['..'] * (len(a) - i) + b[i:])


def site_files(docs):
    out = []
    for root, dirs, files in os.walk(docs):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in files:
            rel = Path(root, f).relative_to(docs).as_posix()
            if not SKIP.search(rel):
                out.append(rel)
    return out


def scan(docs, files):
    """Which files are used, and how (img / bg / zoom). Pages and the CSS they load."""
    exists = set(files)
    used, kinds, texts = set(), {}, {}
    queue = [f for f in files if f.endswith('.html') and '/' not in f]
    used.update(queue)
    seen = set()
    while queue:
        f = queue.pop()
        if f in seen:
            continue
        seen.add(f)
        text = (docs / f).read_text(encoding='utf-8', errors='replace')
        texts[f] = text
        base = f.rsplit('/', 1)[0] if '/' in f else ''
        refs = []
        if f.endswith('.html'):
            refs += [('zoom' if m.group(1).strip().lower().startswith('href') else 'img', m.group(3)) for m in ATTR.finditer(text)]
        refs += [('bg', m.group(3)) for m in URLF.finditer(text)]
        for kind, ref in refs:
            r = resolve(base, ref)[0]
            if not r or r not in exists:
                continue
            kinds.setdefault(r, set()).add(kind)
            if r not in used:
                used.add(r)
                if r.endswith('.css'):
                    queue.append(r)
    return used, kinds, texts


def plan(files, used, kinds):
    taken = {f for f in files if not f.startswith('uploads/')}
    moves = {}
    for f in sorted(u for u in used if u.startswith('uploads/')):
        name = f.rsplit('/', 1)[-1]
        ext = os.path.splitext(name)[1].lower()
        k = kinds.get(f, set())
        if ext in PHOTO | GRAPHIC and ('background-images/' in f or k == {'bg'}):
            folder = 'images/backgrounds'
        elif ext in GRAPHIC:
            folder = 'images/graphics'
        elif ext in PHOTO:
            folder = 'images'
        else:
            folder = 'downloads'
        new = f'{folder}/{name}'
        stem, e = os.path.splitext(name)
        n = 2
        while new in taken:
            new = f'{folder}/{stem}-{n}{e}'
            n += 1
        taken.add(new)
        moves[f] = new
    return moves


def rewrite(text, base, moves):
    def fix(ref):
        r, tail, raw = resolve(base, ref)
        if r not in moves:
            return None
        return quote(relative(base, moves[r]), safe='/-_.~') + tail

    def attr(m):
        new = fix(m.group(3))
        return m.group(0) if new is None else f'{m.group(1)}{m.group(2)}{new}{m.group(2)}'

    def url(m):
        new = fix(m.group(3))
        return m.group(0) if new is None else f'{m.group(1)}{m.group(2)}{new}{m.group(4)}'
    return URLF.sub(url, ATTR.sub(attr, text))


def check(docs):
    files = site_files(docs)
    exists = set(files)
    missing = []
    for f in files:
        if not (f.endswith('.html') and '/' not in f) and not f.endswith('.css'):
            continue
        text = (docs / f).read_text(encoding='utf-8', errors='replace')
        base = f.rsplit('/', 1)[0] if '/' in f else ''
        refs = [m.group(3) for m in ATTR.finditer(text)] if f.endswith('.html') else []
        refs += [m.group(3) for m in URLF.finditer(text)]
        for ref in refs:
            r = resolve(base, ref)[0]
            if r and r not in exists and (r.startswith(('uploads/', 'images/', 'downloads/'))):
                missing.append(f'{f}: {ref}')
    return missing


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    if len(args) != 1:
        sys.exit(__doc__)
    docs = Path(args[0]).resolve()
    if not (docs / 'index.html').exists():
        sys.exit(f'No index.html in {docs}')
    website = docs.parent
    originals = website / 'image-originals'

    files = site_files(docs)
    before_missing = set(check(docs))
    used, kinds, texts = scan(docs, files)
    moves = plan(files, used, kinds)
    if not moves:
        print('Nothing to move: no page uses files from uploads/.')
        return
    counts = {}
    for new in moves.values():
        counts[new.rsplit('/', 1)[0]] = counts.get(new.rsplit('/', 1)[0], 0) + 1
    print(f'{len(moves)} used files move out of uploads/:')
    for k in sorted(counts):
        print(f'   {k}/: {counts[k]}')
    renamed = [(o, n) for o, n in moves.items() if o.rsplit('/', 1)[-1] != n.rsplit('/', 1)[-1]]
    if renamed:
        print(f'   ({len(renamed)} got a number added because the name was taken)')
    unused_left = [f for f in files if f.startswith('uploads/') and f not in used]
    print(f'{len(unused_left)} unused files stay in uploads/ (the editor\'s Images panel can move them out).')

    # pages and style sheets that change
    changes = {}
    for f, text in texts.items():
        base = f.rsplit('/', 1)[0] if '/' in f else ''
        new = rewrite(text, base, moves)
        if new != text:
            changes[f] = new
    # image-originals: originals follow their image, edits.json follows the new paths
    edits_path = originals / 'edits.json'
    edits = json.loads(edits_path.read_text(encoding='utf-8')) if edits_path.exists() else {}
    orig_moves, new_edits = {}, {}
    for key, entry in edits.items():
        newkey = moves.get(key, key)
        entry = dict(entry)
        o = entry.get('original', '')
        if o.startswith('uploads/') and (originals / o).exists():
            target_dir = newkey.rsplit('/', 1)[0] if '/' in newkey else 'images'
            name = o.rsplit('/', 1)[-1]
            dest = f'{target_dir}/{name}'
            stem, e = os.path.splitext(name)
            n = 2
            while (dest in orig_moves.values() and orig_moves.get(o) != dest) or ((originals / dest).exists() and dest != o):
                dest = f'{target_dir}/{stem}-{n}{e}'
                n += 1
            orig_moves.setdefault(o, dest)
            entry['original'] = orig_moves[o]
        new_edits[newkey] = entry
    print(f'{len(changes)} pages/style sheets get new paths; {len(orig_moves)} originals move in image-originals.')
    if dry:
        print('\nDry run: nothing changed. Some of the moves:')
        for o, n in list(moves.items())[:8]:
            print(f'   {o}  ->  {n}')
        return

    # backup
    stamp = time.strftime('%Y-%m-%d'), time.strftime('%H%M%S')
    bdir = website / 'editor-backups' / stamp[0] / f'{stamp[1]}-reorganise'
    bdir.mkdir(parents=True, exist_ok=True)
    for f in changes:
        (bdir / 'docs' / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(docs / f, bdir / 'docs' / f)
    if edits_path.exists():
        shutil.copy2(edits_path, bdir / 'edits.json')
    (bdir / 'moves.json').write_text(json.dumps({'site': moves, 'image-originals': orig_moves}, indent=1), encoding='utf-8')
    print(f'Backup: {bdir.relative_to(website.parent) if website.parent in bdir.parents else bdir}')

    # move files, then write the updated pages
    for old, new in moves.items():
        (docs / new).parent.mkdir(parents=True, exist_ok=True)
        os.replace(docs / old, docs / new)
    for old, new in orig_moves.items():
        (originals / new).parent.mkdir(parents=True, exist_ok=True)
        os.replace(originals / old, originals / new)
    for f, text in changes.items():
        tmp = docs / (f + '.tmp-reorganise')
        tmp.write_text(text, encoding='utf-8')
        os.replace(tmp, docs / f)
    if edits:
        edits_path.write_text(json.dumps(new_edits, indent=1), encoding='utf-8')
    # remove folders that are now empty (also macOS ._ leftovers in them)
    for base in (docs / 'uploads', originals / 'uploads'):
        if not base.exists():
            continue
        for root, dirs, fs in sorted(os.walk(base), key=lambda x: -len(x[0])):
            for f in fs:
                if f.startswith('._') or f == '.DS_Store':
                    try:
                        os.remove(Path(root, f))
                    except OSError:
                        pass
            try:
                os.rmdir(root)
            except OSError:
                pass

    missing = [m for m in check(docs) if m not in before_missing]
    if missing:
        print(f'\nWARNING: {len(missing)} references point to missing files:')
        for m in missing[:20]:
            print('   ' + m)
        sys.exit(1)
    print('\nDone. Every image reference in the site points to an existing file.')


if __name__ == '__main__':
    main()
