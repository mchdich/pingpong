const WINDOW_MS = 10 * 1000;
const memory = new Map();
const read = key => {
  try { return localStorage.getItem(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; }
};
const write = (key, value) => {
  memory.set(key, value);
  try { localStorage.setItem(key, value); } catch {}
};

// Each browser gets ten seconds on its first view; reloads keep the same deadline.
export function activeRelease(value, now = Date.now(), firstShownAt = now) {
  if (!value || typeof value.id !== 'string' || !value.id.trim() ||
      value.id.length > 120 || typeof value.publishedAt !== 'string' || !Array.isArray(value.changes)) return null;
  const publishedAt = Date.parse(value.publishedAt), expiresAt = firstShownAt + WINDOW_MS;
  if (!Number.isFinite(publishedAt) || !Number.isFinite(firstShownAt) || now >= expiresAt) return null;
  const changes = value.changes.filter(change => typeof change === 'string' && change.trim())
    .slice(0, 10).map(change => change.trim().slice(0, 200));
  return changes.length ? { id: value.id, changes, expiresAt } : null;
}

export function showRelease(value) {
  const now = Date.now();
  let release = activeRelease(value, now);
  if (!release || document.getElementById('release-notes')) return null;
  const version = encodeURIComponent(release.id);
  const shownKey = 'pingpong.releaseFirstShown.' + version;
  const dismissedKey = 'pingpong.releaseDismissed.' + version;
  if (read(dismissedKey) === '1') return null;
  const saved = read(shownKey);
  const firstShownAt = saved === null ? now : Number(saved);
  release = activeRelease(value, now, firstShownAt);
  if (!release) return null;
  if (saved === null) write(shownKey, String(firstShownAt));

  const card = document.createElement('section');
  card.id = 'release-notes';
  card.className = 'release-notes';
  card.setAttribute('aria-label', 'Latest game update');
  const heading = document.createElement('h2');
  heading.textContent = 'What’s new';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'release-notes-close';
  close.setAttribute('aria-label', 'Dismiss update');
  close.textContent = '×';
  const list = document.createElement('ul');
  for (const change of release.changes) {
    const item = document.createElement('li');
    item.textContent = change;
    list.append(item);
  }
  card.append(heading, close, list);

  let timer;
  const remove = () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', checkExpiry);
    window.removeEventListener('pageshow', checkExpiry);
    card.remove();
  };
  const checkExpiry = () => {
    clearTimeout(timer);
    const remaining = release.expiresAt - Date.now();
    if (remaining <= 0) remove();
    else timer = setTimeout(checkExpiry, remaining);
  };
  close.addEventListener('pointerdown', event => event.stopPropagation());
  close.addEventListener('click', event => {
    event.stopPropagation();
    write(dismissedKey, '1');
    remove();
  });
  document.addEventListener('visibilitychange', checkExpiry);
  window.addEventListener('pageshow', checkExpiry);
  document.body.append(card);
  checkExpiry();
  return card;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  fetch(new URL('./release.json', import.meta.url), { cache: 'no-store' })
    .then(response => response.ok ? response.json() : null)
    .then(showRelease)
    .catch(() => {});
}
