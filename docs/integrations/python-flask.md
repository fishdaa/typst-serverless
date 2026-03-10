# Python + Flask

Generate PDFs from Flask by running `typst-serverless` via `subprocess`.

## Setup

```bash
pip install flask
```

## Route

```python
import subprocess
import tempfile
import shutil
from pathlib import Path

from flask import Flask, Response, jsonify

app = Flask(__name__)
TYPST_IMAGE = "typst-serverless"


@app.route("/pdf")
def pdf():
    tmp = tempfile.mkdtemp(prefix="typst-")
    try:
        main_typ = Path(tmp) / "main.typ"
        main_typ.write_text("#hello(world)\n")

        result = subprocess.run(
            [
                "docker", "run", "--rm",
                "-v", f"{tmp}:/workspace",
                "-e", "TYPST_WORKSPACE=/workspace",
                "-e", "TYPST_MAIN=main.typ",
                "-e", "TYPST_PIPE=true",
                TYPST_IMAGE,
            ],
            capture_output=True,
            timeout=30,
        )

        if result.returncode != 0:
            return jsonify(error="Compilation failed"), 500

        return Response(
            result.stdout,
            mimetype="application/pdf",
            headers={"Content-Disposition": "attachment; filename=output.pdf"},
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
```

## Run

```bash
flask --app app run
```
