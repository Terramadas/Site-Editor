# Site-Editor
An HTML site editor

## Use
Point-and-click editing of a static website (made for a Weebly export), with Weebly-style
elements: click text to type, drag elements from the side panel, move them, change images,
buttons, sections, columns, pages and the menu.

Open the editor from GitHub Pages, or straight from disk by double-clicking `docs/index.html`
(works offline). Nothing is uploaded anywhere: the editor works on the files on your computer. Upload the site with GitHub
Desktop when you're done.

### Load website (every browser: Safari, Firefox, Chrome, Edge, iPad)
**Load folder…** (the website folder that contains `docs`, or the site folder itself) or
**Load .zip…** (for example a Weebly archive, or a zip the editor made). Your changes stay
in the editor and in the browser, so closing the tab loses nothing: load the same site again
and the editor offers your unsaved work. **Download site** gives the whole site as a .zip
with a `docs` folder inside: replace your website's `docs` folder with it, or load the zip
again to keep editing.

### Open folder (Chrome, Edge, Brave)
**Choose website folder…** saves straight into the folder. The previous version of every
saved page is kept in `editor-backups/` next to the site folder.

### With Python (any browser, saves straight into the folder)
    python3 docs/server.py                      # edits ../Terramadas/website/docs
    python3 docs/server.py /path/to/site/docs   # or any other site folder

Opened from disk, Preview shows the page with its scripts in a new tab, but links to other
pages don't work there (they do from GitHub Pages or Python).

### Images
Every image you add is kept twice: the untouched original goes to `image-originals/` (next to
the site folder, never published) and the site gets an optimised JPEG at the size it is shown
(PNG only when it needs transparency). Camera data such as GPS location is removed from the
site copy. New images go to `images/` (backgrounds to `images/backgrounds/`); **Rename…** gives an image a
new file name and updates every page. **Edit image** (or double-click a picture) crops, rotates, flips, changes brightness,
contrast, saturation, size and quality, always starting from the original;
`image-originals/edits.json` remembers the edits. **Images** in the top bar checks every
image, optimises the ones that are too big and moves files no page uses to `unused-files/`.

`docs/simple-editor.html` is the earlier, simpler editor. `docs/jszip.min.js` is JSZip 3.10.1
(MIT licence, Stuart Knightley).

## New website from a template
**New website…** on the start screen makes a complete site from a free template: choose the
template, type the site name, tagline and your name, and where it goes:

* **In a folder on this computer** (Chrome, Edge, Brave): choose an empty folder (for example a
  new `website` folder); the site goes in its `docs` folder, ready for GitHub Desktop and GitHub Pages.
* **In the editor** (every browser): **Download site** gives you the .zip when you are done.

A template site works like any other site in the editor, plus:

* **＋ New project** (top of the elements): name, date, short text, GitHub address and picture.
  It makes the project's page and puts its card at the top of the overview.
  Click a card to change its picture, date, title, page or GitHub button.
* **Site settings**: the site name, social links (icons in the menu bar), the copyright line,
  the wording of the template credit, and the background picture. Applied to every page.
* The header, footer and copyright line are the same on every page: change the footer on one
  page and saving copies it to all pages.
* Buttons, columns (they stack on phones), images and sections use the template's own style.
* **Change template…** (in Site settings) rebuilds every page in another template: text,
  pictures, buttons, columns, project cards, the footer text, the menu and the site settings come
  along. Section backgrounds and the site's background picture don't (set them again if wanted).
  The old pages are kept in `editor-backups/` (in the editor: Download site first to keep a copy).

### Templates
Three templates by [HTML5 UP](https://html5up.net), in `themes/`:
**Massively** (big title over a photo, project cards), **Phantom** (light, projects as coloured
picture tiles, slide-in menu) and **Editorial** (blog layout with a sidebar). They are licensed
[CC BY 3.0](https://html5up.net/license): free to use and change, as long as the credit link to
HTML5 UP stays. The editor always keeps it at the bottom of the page ("Template by HTML5 UP";
the words can be changed in Site settings, the link can't). Its fonts are reduced to the
modern `.woff2` files and the demo pictures are left out (Editorial keeps one, CC0, as its banner).

A template is the theme's own files (`site/`) plus starter pages made from `templates/`, and
`theme.json`. The parts of a page the editor works with are marked with `data-se="…"`
attributes (`data-se-role` marks the parts that move when switching templates: intro, footer-about,
footer-contact, social), the shared parts with `<!-- se:shared name -->` comments, and every new site
gets `assets/site-editor.json` describing them. After changing a template, run

    python3 tools/build_themes.py

which writes `docs/themes/<name>.js` (the whole starter site in one file, so New website also
works when the editor is opened from disk) and `docs/themes/index.js`. The other HTML5 UP
templates in `themes-incoming/` can be added the same way.

## Privacy: nothing from other websites
A page that loads something from another website (fonts, scripts, forms, videos, pictures) tells
that website the visitor's IP address. The page panel (click next to the page, nothing selected)
says whether the page loads anything from other websites, and lists them. While you edit, the
editor blocks them. The templates load nothing from other websites: their fonts fall back to fonts
every device has (Georgia, Helvetica and similar). Plain links (TidyCal, Buy Me a Coffee…) send
nothing until a visitor clicks them.

## Tools for moving a site off Weebly
`tools/build_site.py` turns a Weebly archive into a working static site (fixes its broken
paths); `tools/localize_weebly.py` downloads the Weebly files the pages still load (needs
internet); `tools/reorganise_images.py` moves the images a site uses out of Weebly's deep
`uploads/5/6/4/5/…` folders into `images/`, `images/backgrounds/` and `images/graphics/`, updating
every page and image-originals (run it with `--dry-run` first to see the plan). They use only
Python's standard library. See the notes at the top of each file.
`tools/build_themes.py` rebuilds the templates for New website (see Templates above).
