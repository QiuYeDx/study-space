# 学习空间 · Study Space

一个纯静态的个人知识库：把 Markdown 笔记按「知识模块」放进文件夹，打开浏览器就能阅读。没有服务端代码、没有构建步骤、不写任何文件。

- **一级入口**：首页列出全部知识模块
- **模块内阅读**：左侧目录（子文件夹即分类）、右侧本页目录、代码高亮、上一篇 / 下一篇
- 标题与正文搜索、浅色 / 深色主题、手机适配
- 新增笔记或模块后刷新即可看到

## 启动与停止（Windows）

需要本机装有 Python 3。

| 操作 | 方式 |
| --- | --- |
| 启动 | 双击 `_reader/启动阅读器.bat`，会自动打开浏览器 |
| 停止 | 双击 `_reader/停止阅读器.bat`，或直接关掉那个最小化的服务窗口 |
| 改端口 | 编辑 `_reader/config.bat` 里的 `set PORT=47321` |

默认地址：<http://localhost:47321/_reader/>

其他系统可以在仓库根目录执行：

```bash
python3 -m http.server 47321 --bind 0.0.0.0
```

> 服务会把整个仓库目录以只读方式公开在这个端口上，不需要的话别对外网开放端口。

## 目录约定

```
学习空间/
├── fullstack/                 ← 一个知识模块（文件夹名会出现在网址里，建议用英文）
│   ├── _module.json           ← 可选：模块标题、简介、图标、排序
│   ├── 01-xxx.md              ← 笔记；文件名前缀数字决定阅读顺序
│   └── database/              ← 子文件夹 = 模块内的分类
│       └── 01-mysql-index.md
├── another-topic/             ← 以后学别的，就再建一个文件夹
└── _reader/                   ← 阅读器本身
```

- 笔记标题取自文件里第一个 `# 标题`，没有就用文件名。
- 以 `.` 或 `_` 开头的文件和文件夹不会出现在阅读器里。
- 根目录下的 `.md`（比如本 README）不会被当作笔记。

`_module.json` 示例：

```json
{
  "title": "全栈工程师转型",
  "description": "一句话介绍这个模块",
  "icon": "🧱",
  "order": 1
}
```

## 技术说明

- `_reader/index.html` + `app.js` + `app.css`，依赖只有本地的 [marked](https://github.com/markedjs/marked) 和 [highlight.js](https://highlightjs.org/)（放在 `_reader/vendor`）。
- 笔记列表来自静态服务器的目录列表页，所以任何会输出目录列表的静态服务器都能用。
