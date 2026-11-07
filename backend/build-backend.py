from pathlib import Path
import json
import sys

root = Path(__file__).resolve().parent.parent
schema = json.loads((root / 'source/questions.json').read_text())
template = (root / 'backend/code-template.gs').read_text()
assert template.count('__BRIEF_SCHEMA__') == 1
code = template.replace('__BRIEF_SCHEMA__', json.dumps(schema, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c'))
if len(sys.argv) > 1:
    code = code.replace('__SPREADSHEET_ID__', sys.argv[1], 1)
if len(sys.argv) > 2:
    code = code.replace('__SUBMIT_KEY_HASH__', sys.argv[2], 1)
private = root / '.private'
private.mkdir(exist_ok=True)
(private / 'Code.gs').write_text(code)
print(json.dumps({'file': str(private / 'Code.gs'), 'bytes': len(code.encode('utf-8'))}))
