#!/usr/bin/env python3
"""Builds index.html: inlines the shader, the ground image and the logo into
src/template.html and wraps it in a full HTML document."""
import base64
from pathlib import Path

src = Path(__file__).parent / "src"
b64 = lambda p: base64.b64encode((src / p).read_bytes()).decode()

page = (src / "template.html").read_text()
page = (page.replace("__FRAG__", (src / "cloud-flight.frag").read_text())
            .replace("__GROUND__", b64("landsat_farmland_poland.jpg"))
            .replace("__LOGO__", "data:image/png;base64," + b64("vioso-logo.png")))

html = f"""<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>body{{margin:0}}img{{max-width:100%}}</style>
{page}
</html>
"""
(Path(__file__).parent / "index.html").write_text(html)
print("index.html", len(html), "bytes")
