"""Xuất các chuỗi tiếng Trung mà backend trả về cho giao diện, để frontend phủ lớp nghĩa tiếng Việt qua label().

Chỉ đọc mã nguồn (AST), không import app, không sửa gì ở backend. Thu thập:
- Giá trị của các khóa hiển thị (name, reverse_name, category, description, label, title, message...) trong dict literal
  (loại quan hệ dựng sẵn, danh mục/tag prompt, định nghĩa mẫu prompt, phong cách viết...).
- Phần tử list/tuple/dict trong app/constants.
- Thông báo lỗi HTTPException(detail=...). f-string được chuyển thành mẫu với {{0}}, {{1}}...
- Thông báo tiến trình/lỗi gửi qua SSE (SSEResponse, *ProgressTracker, progress_callback...).
- Mô tả Skill trong app/skills/*/SKILL.md.

Chạy: python backend/scripts/export_i18n_values.py
Kết quả: frontend/src/i18n/locales/values.source.json
"""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "backend" / "app"
OUT = ROOT / "frontend" / "src" / "i18n" / "locales" / "values.source.json"

HAN = re.compile(r"[一-鿿]")
DISPLAY_KEYS = {
    "name", "reverse_name", "category", "category_name", "description", "label", "title",
    "display_name", "message", "detail", "status_text", "tip", "hint",
}
MAX_LEN = 300
# Hàm gửi tiến trình / lỗi qua SSE hoặc task nền: chuỗi truyền vào hiện trên giao diện.
PROGRESS_FUNCS = {
    "send_progress", "send_error", "progress_callback", "progress_cb", "_progress", "_progress_callback",
    "update_progress", "_update_progress",
}
PROGRESS_CTORS = re.compile(r"(ProgressTracker|StageConfig)$")
# Gom mọi chuỗi (kể cả f-string) trong các file này: dữ liệu mẫu và thông báo mặc định của tracker tiến trình.
WHOLE_FILES = {"init_relationship_types.py", "sse_response.py", "background_task_service.py"}
PROGRESS_KWARGS = {"message", "error", "default_message", "status_message", "task_name"}


def is_candidate(text: str) -> bool:
    return bool(text) and bool(HAN.search(text)) and len(text) <= MAX_LEN and "\n\n" not in text


def joined_to_pattern(node: ast.JoinedStr) -> str | None:
    parts: list[str] = []
    index = 0
    for value in node.values:
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            parts.append(value.value)
        else:
            parts.append("{{%d}}" % index)
            index += 1
    pattern = "".join(parts).strip()
    literal = re.sub(r"\{\{\d+\}\}", "", pattern)
    if not HAN.search(literal) or len(pattern) > MAX_LEN:
        return None
    return pattern


def string_of(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value.strip()
    if isinstance(node, ast.JoinedStr):
        return joined_to_pattern(node)
    return None


class Collector(ast.NodeVisitor):
    def __init__(self, whole_file: bool):
        self.whole_file = whole_file
        self.found: set[str] = set()

    def add(self, node: ast.AST) -> None:
        text = string_of(node)
        if text and is_candidate(text):
            self.found.add(text)

    def visit_Dict(self, node: ast.Dict) -> None:
        for key, value in zip(node.keys, node.values):
            if isinstance(key, ast.Constant) and key.value in DISPLAY_KEYS:
                self.add(value)
            elif self.whole_file:
                self.add(value)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else ""
        receiver = func.value.id if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) else ""
        is_progress = (
            name in PROGRESS_FUNCS
            or PROGRESS_CTORS.search(name or "")
            or ("tracker" in receiver.lower() or receiver == "SSEResponse")
        )
        if is_progress and receiver != "logger":
            for arg in node.args:
                self.add(arg)
            for kw in node.keywords:
                if kw.arg in PROGRESS_KWARGS:
                    self.add(kw.value)
        if name == "HTTPException":
            for kw in node.keywords:
                if kw.arg == "detail":
                    self.add(kw.value)
            if len(node.args) >= 2:
                self.add(node.args[1])
        self.generic_visit(node)

    def visit_JoinedStr(self, node: ast.JoinedStr) -> None:
        if self.whole_file:
            self.add(node)

    def visit_Assign(self, node: ast.Assign) -> None:
        if self.whole_file:
            self.add(node.value)
        self.generic_visit(node)

    def visit_BoolOp(self, node: ast.BoolOp) -> None:
        if self.whole_file:
            for value in node.values:
                self.add(value)
        self.generic_visit(node)

    def visit_List(self, node: ast.List) -> None:
        if self.whole_file:
            for elt in node.elts:
                self.add(elt)
        self.generic_visit(node)

    visit_Tuple = visit_List  # type: ignore[assignment]


def skill_descriptions() -> set[str]:
    found: set[str] = set()
    for skill_md in (APP / "skills").glob("*/SKILL.md"):
        text = skill_md.read_text(encoding="utf-8")
        match = re.search(r"^description:\s*\|?\s*\n?((?:\s{2,}.+\n?)+|.+)$", text, re.M)
        if not match:
            continue
        for line in match.group(1).splitlines():
            line = line.strip()
            if is_candidate(line):
                found.add(line)
    return found


def main() -> None:
    found: set[str] = set()
    for path in APP.rglob("*.py"):
        whole = path.parent.name == "constants" or path.name in WHOLE_FILES
        collector = Collector(whole_file=whole)
        try:
            collector.visit(ast.parse(path.read_text(encoding="utf-8")))
        except SyntaxError:
            continue
        found |= collector.found
    found |= skill_descriptions()
    OUT.write_text(json.dumps(sorted(found), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(found)} strings -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
