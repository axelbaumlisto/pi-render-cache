#!/usr/bin/env python3
"""Короткая строка из одного файла замера."""
import json, os, sys

path = sys.argv[1]
try:
    d = json.load(open(path))
except Exception:
    print(f"  {os.path.basename(path)}: нет данных"); sys.exit(0)

parts = os.path.basename(path).replace(".json", "").split("__")
where = parts[1] if len(parts) > 1 else d.get("probe", "?")
p = d.get("probe")

if p == "frames":
    print(f"  {where:22} кадров {d['frames']:3}, {d['msPerFrame']:6.2f} мс/кадр, "
          f"картинки {d['imageScanShare']:4.1f}% кадра, ЦПУ {d['cpuUserSec']:5.1f} с, память {d['rssMb']} МБ")
elif p == "classes":
    top = sorted(d["classes"].items(), key=lambda x: -x[1]["selfMs"])[:4]
    print(f"  {where:22} " + ", ".join(f"{k} {v['selfMs']:.1f} мс/{v['calls']}" for k, v in top))
elif p == "children":
    top = sorted(d["counts"].items(), key=lambda x: -x[1])[:4]
    print(f"  {where:22} " + ", ".join(f"{k} ×{v}" for k, v in top))
elif p == "segmenter":
    print(f"  {where:22} вызовов {d['calls']:6}, символов {d['chars']:8}, {d['ms']:7.1f} мс")
elif p == "triggers":
    top = sorted(d["origins"].items(), key=lambda x: -x[1])[:3]
    print(f"  {where:22} " + ", ".join(f"{k} ×{v}" for k, v in top))
else:
    print(f"  {where:22} {d}")
