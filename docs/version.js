/* The editor's version. Bump it with EVERY change to the editor (and add a line to the changelog in README.md).
   It shows next to "Site editor" in the top bar and on the start screen, so you can see which copy of the editor is running. */
const SE_VERSION = { number: '1.5', date: '21 Nov 2026' };
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.seVersion').forEach(el => {
    el.textContent = 'v' + SE_VERSION.number;
    el.title = 'Site editor version ' + SE_VERSION.number + ' (' + SE_VERSION.date + ')';
  });
});
