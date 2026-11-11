"""Package the existing offline app as an unpacked MV3 extension and a ZIP."""
from pathlib import Path
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'extension'
manifest = json.loads((ROOT / 'chrome/manifest.json').read_text())
if OUTPUT.exists():
    shutil.rmtree(OUTPUT)
shutil.copytree(ROOT / 'dist', OUTPUT)
shutil.copytree(ROOT / 'chrome', OUTPUT, dirs_exist_ok=True)
# A directory URL is not a document in a Chrome extension.
index = OUTPUT / 'index.html'
index.write_text(index.read_text().replace('href="./"', 'href="index.html"'))
releases = ROOT / 'releases'
releases.mkdir(exist_ok=True)
archive = releases / f'diffnote-chrome-{manifest["version"]}.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
    for path in sorted(OUTPUT.rglob('*')):
        if path.is_file():
            bundle.write(path, path.relative_to(OUTPUT))
print(f'Unpacked extension: {OUTPUT}')
print(f'Install / Chrome Web Store ZIP: {archive}')
