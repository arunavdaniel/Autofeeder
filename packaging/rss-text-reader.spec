from pathlib import Path
import sys

from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []
for package in ("feedparser", "bs4", "trafilatura", "playwright"):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

a = Analysis([str(Path(SPECPATH).parent / "launcher.py")],
             pathex=[str(Path(SPECPATH).parent)], datas=datas,
             binaries=binaries, hiddenimports=hiddenimports)
pyz = PYZ(a.pure)
icon_path = str(Path(SPECPATH).parent / "packaging" / "icon.icns") if sys.platform == "darwin" else None
exe = EXE(pyz, a.scripts, a.binaries, a.datas, name="RSS Text Reader", console=False,
          icon=icon_path)
if sys.platform == "darwin":
    app = BUNDLE(exe, name="RSS Text Reader.app", icon=icon_path,
                 bundle_identifier="com.rsstextreader.app")
