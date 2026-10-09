"""把知识库打包成可部署到任意静态服务器（如阿里云 OSS）的 _dist 目录。

本地阅读器靠静态服务器的「目录列表页」发现笔记；OSS、CDN 这类静态托管没有目录列表，
所以这里提前扫描一遍，把模块、子文件夹、笔记和时间写进 _reader/manifest.js，阅读器有清单时就读清单。

用法（在仓库任意位置执行均可）：
    python _reader/build.py               # 输出到仓库根目录下的 _dist/（_ 开头，本地阅读器不会把它当成模块）
    python _reader/build.py --out D:/site # 输出到指定目录（会先清空）
"""
import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

READER = Path(__file__).resolve().parent
ROOT = READER.parent
NOTE_RE = re.compile(r"\.(md|markdown)$", re.I)
# 阅读器运行需要的文件；构建脚本、启动脚本等只在本地使用，不进 dist
READER_FILES = ["index.html", "app.js", "app.css", "vendor"]


def hidden(name: str) -> bool:
    return name.startswith(".") or name.startswith("_")


def scan(dir_path: Path, rel: str, depth: int = 0) -> dict:
    """与 app.js 的 listDir 规则一致：跳过 . 和 _ 开头的项，只收录含笔记的文件夹。"""
    node = {"dirs": [], "notes": []}
    if depth > 6:
        return node
    meta_file = dir_path / "_module.json"
    if rel and meta_file.is_file():
        try:
            node["meta"] = json.loads(meta_file.read_text(encoding="utf-8-sig"))
        except ValueError as e:
            print(f"  警告：{meta_file.relative_to(ROOT)} 不是合法的 JSON，已忽略（{e}）")
    for child in sorted(dir_path.iterdir(), key=lambda p: p.name):
        if hidden(child.name):
            continue
        child_rel = f"{rel}/{child.name}" if rel else child.name
        if child.is_dir():
            sub = scan(child, child_rel, depth + 1)
            if sub["dirs"] or sub["notes"]:
                node["dirs"].append({"name": child.name, "rel": child_rel, **sub})
        elif rel and NOTE_RE.search(child.name):
            mtime = datetime.fromtimestamp(child.stat().st_mtime, timezone.utc)
            node["notes"].append({"name": child.name, "rel": child_rel,
                                  "modified": mtime.isoformat(timespec="seconds")})
    return node


def count(node: dict) -> int:
    return len(node["notes"]) + sum(count(d) for d in node["dirs"])


def main() -> int:
    ap = argparse.ArgumentParser(description="生成可部署到静态服务器的 _dist 目录")
    ap.add_argument("--out", default=str(ROOT / "_dist"), help="输出目录，默认是仓库根目录下的 _dist/（_ 开头，本地阅读器不会把它当成模块）")
    out = Path(ap.parse_args().out).resolve()
    if out == ROOT or out in ROOT.parents or out == READER:
        print(f"输出目录不能是仓库根目录、它的上级或阅读器目录：{out}")
        return 1
    if ROOT in out.parents and not hidden(out.relative_to(ROOT).parts[0]):
        print(f"输出目录在仓库里时，最外层文件夹要以 _ 开头（否则会被当成知识模块）：{out}")
        return 1

    tree = scan(ROOT, "")
    if not tree["dirs"]:
        print("没有找到任何知识模块（仓库根目录下包含 .md 的文件夹）")
        return 1

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    # 1. 知识模块：整个文件夹原样复制（图片等资源也一起带上），只排除 . 开头的隐藏项
    ignore = shutil.ignore_patterns(".*")
    for mod in tree["dirs"]:
        shutil.copytree(ROOT / mod["name"], out / mod["name"], ignore=ignore)

    # 2. 阅读器本身 + 清单
    (out / "_reader").mkdir()
    for name in READER_FILES:
        src = READER / name
        (shutil.copytree if src.is_dir() else shutil.copy2)(src, out / "_reader" / name)
    generated = datetime.now(timezone.utc)
    manifest = {"version": 1, "generated": generated.isoformat(timespec="seconds"), "tree": tree}
    # 写成 JS 而不是 JSON：dist 的 index.html 用 <script> 引入；本地版本不引入，也就不会多一次 404 请求
    (out / "_reader" / "manifest.js").write_text(
        "window.STUDY_SPACE_MANIFEST = " + json.dumps(manifest, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8")
    index = out / "_reader" / "index.html"
    html = index.read_text(encoding="utf-8")
    tag = '<script src="app.js"></script>'
    if tag not in html:
        print("_reader/index.html 里找不到 app.js 的 script 标签，无法注入清单")
        return 1
    # 带上版本号，重新部署后浏览器 / CDN 不会继续用旧的清单和脚本
    v = generated.strftime("%Y%m%d%H%M%S")
    html = html.replace(tag, f'<script src="manifest.js?v={v}"></script>\n<script src="app.js?v={v}"></script>')
    html = html.replace('href="app.css"', f'href="app.css?v={v}"')
    index.write_text(html, encoding="utf-8")

    # 3. 站点首页：跳到阅读器（用相对路径，部署在 OSS 的任意子路径下都能用）
    (out / "index.html").write_text(
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="robots" content="noindex, nofollow">'
        '<title>学习空间</title>'
        '<meta http-equiv="refresh" content="0; url=_reader/index.html">'
        '<script>location.replace("_reader/index.html" + location.hash)</script>'
        '</head><body><a href="_reader/index.html">打开学习空间</a></body></html>\n',
        encoding="utf-8")

    print(f"已生成：{out}")
    print(f"  {len(tree['dirs'])} 个模块，{count(tree)} 篇笔记")
    print("  把这个目录里的全部内容上传到静态服务器（如 OSS Bucket 根目录或某个子目录）即可访问，详见 README。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
