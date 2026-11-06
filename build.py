from pathlib import Path
import json

root = Path(__file__).resolve().parent
schema = json.loads((root / "source/questions.json").read_text(encoding="utf-8"))
questions = [q for s in schema["sections"] for q in s["questions"]]
by_id = {q["id"]: q for q in questions}
assert len(by_id) == len(questions), "Duplicate question IDs"
allowed = {"text", "textarea", "single", "multi", "scale", "tolerance", "table"}

def clauses(q):
    value = q.get("when", [])
    return [value] if isinstance(value, dict) else value

def check_path(q, parents):
    assert q["id"] not in parents, "Cyclic visibility rules"
    for c in clauses(q):
        assert c["id"] in by_id, "Unknown conditional parent"
        parent = by_id[c["id"]]
        values = c.get("in", c.get("has", []))
        assert values and set(values).issubset(set(parent.get("options", []))), "Unknown conditional choice"
        if "has" in c:
            assert parent["type"] == "multi", "has requires a multi-choice parent"
        check_path(parent, parents | {q["id"]})

for q in questions:
    assert q["type"] in allowed, q["id"]
    assert set(q.get("exclusive", [])).issubset(set(q.get("options", []))), q["id"]
    check_path(q, set())
source = (root / "source/template.html").read_text(encoding="utf-8")
assert source.count("__BRIEF_SCHEMA__") == 1
payload = json.dumps(schema, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
html = source.replace("__BRIEF_SCHEMA__", payload)
(root / "index.html").write_text(html, encoding="utf-8")
print(json.dumps({"sections": len(schema["sections"]), "questions": len(questions), "unconditional": sum(not q.get("when") for q in questions), "conditional": sum(bool(q.get("when")) for q in questions), "html_bytes": len(html.encode("utf-8"))}, ensure_ascii=False))
