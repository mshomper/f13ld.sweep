/* ============================================================
   F13LD.sweep · 05-log.js
   Run log panel.
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
}
