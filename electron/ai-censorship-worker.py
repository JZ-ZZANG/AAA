import json
import sys


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


ALIASES = {
    "nipple": {"nipple", "nipples", "female_breast", "female_breasts", "breast", "breasts"},
    "penis": {"penis", "male_genitalia", "male_genital", "male_genitals"},
    "vulva": {"vulva", "vagina", "female_genitalia", "female_genital", "female_genitals"},
    "anus": {"anus", "buttocks_anus", "anal"},
}


def canonical_label(value):
    normalized = str(value).strip().lower().replace(" ", "_").replace("-", "_")
    for target, aliases in ALIASES.items():
        if normalized in aliases:
            return target
    return normalized


def load_ultralytics(model_path):
    from ultralytics import YOLO
    model = YOLO(model_path)
    if getattr(model, "task", None) != "segment":
        raise RuntimeError("영역 마스크를 지원하는 YOLO 세그멘테이션 모델이 아닙니다.")

    def predict(image_path, confidence, image_size):
        result = model.predict(source=image_path, conf=confidence, imgsz=image_size, verbose=False)[0]
        names = result.names
        detections = []
        if result.boxes is None:
            return detections
        if result.masks is None:
            raise RuntimeError("모델이 세그멘테이션 마스크를 반환하지 않았습니다.")
        polygons = result.masks.xy
        for box, score, class_id, polygon in zip(result.boxes.xyxy.cpu().tolist(), result.boxes.conf.cpu().tolist(), result.boxes.cls.cpu().tolist(), polygons):
            label = names.get(int(class_id), str(int(class_id))) if isinstance(names, dict) else names[int(class_id)]
            detections.append({"box": box, "polygon": polygon.tolist(), "confidence": float(score), "label": str(label)})
        return detections

    return predict, "Ultralytics YOLO"


def tensor_rows(output):
    if isinstance(output, (list, tuple)):
        output = output[0]
    if isinstance(output, dict):
        boxes = output.get("boxes")
        scores = output.get("scores")
        labels = output.get("labels")
        if boxes is not None and scores is not None and labels is not None:
            return [[*box, score, label] for box, score, label in zip(boxes.detach().cpu().tolist(), scores.detach().cpu().tolist(), labels.detach().cpu().tolist())]
    if hasattr(output, "detach"):
        rows = output.detach().cpu().tolist()
        if rows and isinstance(rows[0], list) and rows and isinstance(rows[0][0], list):
            rows = rows[0]
        return rows
    raise RuntimeError("지원하는 탐지 출력(boxes/scores/labels 또는 Nx6)을 찾지 못했습니다.")


def load_torch(model_path):
    import numpy as np
    import torch
    from PIL import Image

    try:
        model = torch.jit.load(model_path, map_location="cpu")
        model_kind = "TorchScript"
    except Exception:
        model = torch.load(model_path, map_location="cpu", weights_only=False)
        if isinstance(model, dict) and callable(model.get("model")):
            model = model["model"]
        model_kind = "PyTorch"
    if not callable(model):
        raise RuntimeError(".pt 파일에서 실행 가능한 모델을 찾지 못했습니다.")
    model.eval()
    names = getattr(model, "names", {})

    def predict(image_path, confidence):
        image = Image.open(image_path).convert("RGB")
        original_width, original_height = image.size
        resized = image.resize((640, 640))
        array = np.asarray(resized, dtype=np.float32) / 255.0
        tensor = torch.from_numpy(array).permute(2, 0, 1).unsqueeze(0)
        with torch.inference_mode():
            rows = tensor_rows(model(tensor))
        detections = []
        for row in rows:
            if len(row) < 6 or float(row[4]) < confidence:
                continue
            class_id = int(row[5])
            label = names.get(class_id, str(class_id)) if isinstance(names, dict) else names[class_id] if class_id < len(names) else str(class_id)
            detections.append({
                "box": [float(row[0]) * original_width / 640, float(row[1]) * original_height / 640, float(row[2]) * original_width / 640, float(row[3]) * original_height / 640],
                "confidence": float(row[4]),
                "label": canonical_label(label),
            })
        return detections

    return predict, model_kind


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("작업 설정 파일이 필요합니다.")
    with open(sys.argv[1], "r", encoding="utf-8") as stream:
        job = json.load(stream)
    model_path = job["modelPath"]
    try:
        predictor, model_kind = load_ultralytics(model_path)
    except Exception as error:
        raise RuntimeError(f"YOLO 세그멘테이션 모델을 불러오지 못했습니다: {error}")
    emit({"type": "loaded", "model": model_kind})
    targets = set(job.get("targets", []))
    confidence = max(0.01, min(1.0, float(job.get("confidence", 0.5))))
    image_size = max(320, min(4096, int(job.get("imageSize", 640))))
    for index, item in enumerate(job.get("files", [])):
        try:
            detections = predictor(item["path"], confidence, image_size)
            if targets:
                detections = [detection for detection in detections if canonical_label(detection["label"]) in targets or detection["label"] in targets]
            emit({"type": "result", "index": index, "detections": detections})
        except Exception as error:
            emit({"type": "result", "index": index, "detections": [], "error": str(error)})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"type": "fatal", "error": str(error)})
        sys.exit(1)
