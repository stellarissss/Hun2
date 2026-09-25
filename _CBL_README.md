# 中华书名库

中文书籍书名数据采集与整理项目。

## 目录结构

| 目录 | 说明 |
|---|---|
| `chinese_books_scraper/` | 书名数据采集爬虫（Scrapy） |
| `.trae/` | 编辑器配置 |

## 数据采集

采集脚本位于 `chinese_books_scraper/`，包含：

- `main.py` — 入口
- `crawl_all.py` — 全量采集
- `spiders/` — 各站点爬虫
- `config/` — 站点配置
- `output/` — 采集结果
- `logs/` — 运行日志

采集流程与配置说明见 `chinese_books_scraper/` 内各文件注释。

## 许可

本项目采用 Apache License 2.0，详见 [`LICENSE`](./LICENSE)。
