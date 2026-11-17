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
site copy. **Edit image** (or double-click a picture) crops, rotates, flips, changes brightness,
contrast, saturation, size and quality, always starting from the original;
`image-originals/edits.json` remembers the edits. **Images** in the top bar checks every
image, optimises the ones that are too big and moves files no page uses to `unused-files/`.

`docs/simple-editor.html` is the earlier, simpler editor. `docs/jszip.min.js` is JSZip 3.10.1
(MIT licence, Stuart Knightley).

## Tools for moving a site off Weebly
`tools/build_site.py` turns a Weebly archive into a working static site (fixes its broken
paths); `tools/localize_weebly.py` downloads the Weebly files the pages still load (needs
internet). Both use only Python's standard library. See the notes at the top of each file.
