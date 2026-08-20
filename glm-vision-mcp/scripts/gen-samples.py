# -*- coding: utf-8 -*-
"""生成无敏感信息的测试样本：
1) samples/ocr-sample.png      — 含中文文字的图片（测 OCR）
2) samples/chart-sample.png    — 简单图表（测图表理解）
3) samples/sample-doc.pdf      — 单页 PDF 文档（测文档分析）
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(HERE, "..", "samples")
os.makedirs(SAMPLES, exist_ok=True)

def pick_font(size):
    for f in [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf",
              r"C:\Windows\Fonts\simsun.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size)
            except Exception:
                continue
    return ImageFont.load_default()

# ---------- 1) OCR 中文图片 ----------
W, H = 640, 400
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
d.rectangle([0, 0, W - 1, H - 1], outline="#222222", width=3)
d.text((30, 30), "会议纪要", font=pick_font(44), fill="#c0392b")
d.text((30, 110), "议题：季度经营复盘", font=pick_font(30), fill="#222222")
d.text((30, 160), "参会人：张三、李四、王五", font=pick_font(28), fill="#444444")
d.text((30, 210), "结论：营收环比增长 12%", font=pick_font(28), fill="#1a5276")
d.text((30, 260), "待办：周五前提交预算表", font=pick_font(28), fill="#1e8449")
d.text((30, 330), "GLM-OCR-TEST-2026", font=pick_font(24), fill="#888888")
img.save(os.path.join(SAMPLES, "ocr-sample.png"))
print("ocr-sample.png OK")

# ---------- 2) 简单图表 ----------
W2, H2 = 560, 380
chart = Image.new("RGB", (W2, H2), "white")
d2 = ImageDraw.Draw(chart)
bars = [("Q1", 90), ("Q2", 150), ("Q3", 210), ("Q4", 170)]
colors = ["#3498db", "#e74c3c", "#2ecc71", "#f39c12"]
base_y = 320
max_h = 200
for i, (label, v) in enumerate(bars):
    x0 = 60 + i * 120
    h = int(v / 260 * max_h)
    d2.rectangle([x0, base_y - h, x0 + 60, base_y], fill=colors[i], outline="#222")
    d2.text((x0 + 10, base_y - h - 30), str(v), font=pick_font(22), fill="#222")
    d2.text((x0 + 15, base_y + 8), label, font=pick_font(24), fill="#222")
d2.text((20, 20), "2026 年销售额（万元）", font=pick_font(28), fill="#222")
chart.save(os.path.join(SAMPLES, "chart-sample.png"))
print("chart-sample.png OK")

# ---------- 3) 单页 PDF ----------
pdf = Image.new("RGB", (1240, 1754), "white")
dp = ImageDraw.Draw(pdf)
dp.rectangle([60, 60, 1180, 1694], outline="#333", width=4)
dp.text((100, 120), "项目周报", font=pick_font(64), fill="#c0392b")
dp.text((100, 260), "1. 本周完成：登录模块、报表导出", font=pick_font(40), fill="#222")
dp.text((100, 360), "2. 风险：接口联调延迟 2 天", font=pick_font(40), fill="#222")
dp.text((100, 460), "3. 下周计划：性能优化与压测", font=pick_font(40), fill="#222")
pdf.save(os.path.join(SAMPLES, "sample-doc.pdf"), "PDF", resolution=100)
print("sample-doc.pdf OK")
