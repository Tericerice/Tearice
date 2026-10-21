"""在观众电脑上运行随包附带的 OCR 模型，不调用远程服务。"""
import numpy as np

_engine = None


def prepare_ocr():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1)
    return _engine


def recognize(image):
    rows, _ = prepare_ocr()(np.asarray(image.convert('RGB'))[:, :, ::-1].copy())
    nodes = []
    for box, text, score in rows or []:
        text = text.strip()
        if text and score >= .4:
            nodes.append(dict(text=text, cx=round(sum(p[0] for p in box) / 4),
                              cy=round(sum(p[1] for p in box) / 4)))
    return nodes
