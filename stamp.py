# Cache-busting: sets every ?v= on a local file reference in index.html to the first 8 hex of that file's sha1.
# GitHub Pages caches for 10 minutes; a new ?v= makes phones fetch the new file. Run after changing any asset.
import hashlib, pathlib, re
root = pathlib.Path(__file__).parent
html = root / "index.html"
def sub(m):
    f = root / m.group(1)
    return m.group(1) + "?v=" + hashlib.sha1(f.read_bytes()).hexdigest()[:8] if f.exists() else m.group(0)
t = re.sub(r'((?:assets/[\w.-]+|app\.js))\?v=[\w]+', sub, html.read_text())
html.write_text(t)
for m in sorted(set(re.findall(r'(?:assets/[\w.-]+|app\.js)\?v=\w+', t))): print(m)
