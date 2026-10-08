/* ============================================================
   F13LD.sweep · 05-log.js
   Run log (Configure drawer → Log; the latest line shows in the dock).
   ============================================================ */


function log(type, msg) {
  const body = document.getElementById('logBody');
  const now = new Date().toTimeString().slice(0, 8);
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.innerHTML = `<span class="log-time">${now}</span><span class="log-msg">${msg}</span>`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
  if (body.children.length > 1 && body.children[0].querySelector('.log-time')?.textContent === '—') {
    body.children[0].remove();
  }
  if (typeof dockLog === 'function') dockLog(type, msg);   /* v0.25.0 — the dock's log chip */
}

/* Text from a recipe or a file name goes into the log as text, not markup. */
function escapeLog(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
