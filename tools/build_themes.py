#!/usr/bin/env python3
"""Turn the templates in Site-Editor/themes/ into files the editor can use offline.

Usage (from the Site-Editor folder):

    python3 tools/build_themes.py

For every themes/<id>/theme.json this writes docs/themes/<id>.js (the whole starter site in one
file, so "New website" also works when the editor is opened from disk) and docs/themes/index.js
(the list of templates). Run it again after changing a theme. Only Python's standard library is used.
"""
import base64
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
THEMES, OUT = ROOT / 'themes', ROOT / 'docs' / 'themes'
TEXT = {'.html', '.css', '.js', '.json', '.txt', '.svg', '.md'}


def fill(tpl, values):
    """{{key}} -> value (HTML-escaped); <!--se:if key-->…<!--/se:if--> only when the value is set."""
    tpl = re.sub(r'<!--se:if (\w+)-->(.*?)<!--/se:if-->', lambda m: m.group(2) if values.get(m.group(1)) else '', tpl, flags=re.S)
    return re.sub(r'\{\{([a-z]\w*)\}\}', lambda m: html.escape(str(values.get(m.group(1), '')), quote=True), tpl)


def page(theme_dir, meta, name, spec, card, project_main):
    t = lambda f: (theme_dir / 'templates' / f).read_text(encoding='utf-8')
    menu = '\n'.join('\t\t\t\t\t<li%s><a href="%s">%s</a></li>' % (' class="active"' if f == name else '', f, s['menuTitle'])
                     for f, s in meta['pages'].items() if s.get('menuTitle'))
    if spec.get('project'):
        main = fill(project_main, meta['sampleProject'])
    else:
        main = t(spec['main']).replace('{{CARD}}', card.rstrip('\n'))
    out = t('skeleton.html')
    for k, v in {'{{INTRO}}': t('intro.html').rstrip('\n') if spec.get('intro') else '', '{{MENU}}': menu,
                 '{{MAIN}}': main.rstrip('\n'), '{{TITLE}}': spec['title'], '{{DESCRIPTION}}': spec['description'],
                 '{{WRAPPER_CLASS}}': ' class="%s"' % spec['wrapperClass'] if spec.get('wrapperClass') else ''}.items():
        out = out.replace(k, v)
    return out


def build(theme_dir):
    meta = json.loads((theme_dir / 'theme.json').read_text(encoding='utf-8'))
    t = lambda f: (theme_dir / 'templates' / f).read_text(encoding='utf-8')
    card_tpl, project_main = t('project-card.html'), t('project-main.html')
    files = {}
    for f in sorted((theme_dir / 'site').rglob('*')):
        if f.is_file() and not f.name.startswith(('.', '._')):
            files[f.relative_to(theme_dir / 'site').as_posix()] = f.read_bytes()
    card = fill(card_tpl, meta['sampleProject'])
    for name, spec in meta['pages'].items():
        files[name] = page(theme_dir, meta, name, spec, card, project_main).encode('utf-8')
    cfg = dict(meta['config'])
    cfg['theme'] = {k: meta[k] for k in ('id', 'name', 'by', 'url', 'licence', 'licenceUrl')}
    cfg['newPage'] = dict(cfg.get('newPage', {}), main=t('page-main.html'))
    cfg['project'] = dict(cfg.get('project', {}), card=card_tpl, page=project_main)
    files['assets/site-editor.json'] = json.dumps(cfg, indent=1, ensure_ascii=False).encode('utf-8')
    if (theme_dir / 'LICENSE.txt').exists():
        files['assets/LICENSE-template.txt'] = (theme_dir / 'LICENSE.txt').read_bytes()
    packed = {}
    for p, b in files.items():
        packed[p] = {'t': b.decode('utf-8')} if Path(p).suffix in TEXT else {'b': base64.b64encode(b).decode('ascii')}
    info = {k: meta[k] for k in ('id', 'name', 'by', 'url', 'licence', 'licenceUrl', 'description')}
    info['order'] = meta.get('order', 99)
    info['size'] = sum(len(b) for b in files.values())
    bundle = dict(info, files=packed)
    OUT.mkdir(parents=True, exist_ok=True)
    js = ('/* Built by tools/build_themes.py from themes/%s. Template: %s by %s, %s. */\n'
          '(window.SITE_EDITOR_THEME_DATA = window.SITE_EDITOR_THEME_DATA || {})[%s] = %s;\n'
          % (meta['id'], meta['name'], meta['by'], meta['licence'], json.dumps(meta['id']), json.dumps(bundle, ensure_ascii=False)))
    (OUT / (meta['id'] + '.js')).write_text(js, encoding='utf-8')
    print('%-12s %3d files, %4d KB site, %4d KB bundle' % (meta['id'], len(files), info['size'] // 1024, len(js) // 1024))
    return info


def main():
    infos = [build(d) for d in sorted(THEMES.iterdir()) if (d / 'theme.json').exists()]
    infos.sort(key=lambda i: (i.get('order', 99), i['name']))
    if not infos:
        sys.exit('No themes found in ' + str(THEMES))
    (OUT / 'index.js').write_text('/* Built by tools/build_themes.py: the templates for "New website". */\n'
                                  'window.SITE_EDITOR_THEMES = %s;\n' % json.dumps(infos, indent=1, ensure_ascii=False), encoding='utf-8')
    print('Wrote', OUT / 'index.js')


if __name__ == '__main__':
    main()
