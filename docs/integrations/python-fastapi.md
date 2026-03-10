# Python + FastAPI

Generate PDFs from FastAPI by running `typst-serverless` via `subprocess`.

## Setup

```bash
pip install fastapi uvicorn
```

## Route

```python
import subprocess
import tempfile
import shutil
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response

app = FastAPI()
TYPST_IMAGE = "typst-serverless"


@app.get("/pdf")
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
            return JSONResponse(
                status_code=500,
                content={"error": "Compilation failed"},
            )

        return Response(
            content=result.stdout,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=output.pdf"},
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
```

## Run

```bash
uvicorn app:app --reload
```
