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

## Lambda (AWS SDK)

If you've deployed the Lambda stack ([docs/lambda/](../lambda/README.md)):

```python
import boto3
import base64
import json

lambda_client = boto3.client("lambda")
payload = {
    "action": "compile",
    "mainTyp": base64.b64encode(b"#set page(width: 100pt)\nHello!").decode(),
}
resp = lambda_client.invoke(
    FunctionName="typst-compile-xxx",
    Payload=json.dumps(payload),
)
result = json.loads(resp["Payload"].read())
# result["pdf"] = base64 PDF, or result["s3Url"] if storeToS3
```

## REST API (HTTP POST)

If API Gateway is enabled ([docs/api/](../api/README.md)), skip boto3 entirely and call the HTTP endpoint:

```bash
pip install requests
```

```python
import base64
import requests
from flask import Flask, request, Response, jsonify

app = Flask(__name__)
API_URL = "https://xxxx.execute-api.us-east-1.amazonaws.com"


@app.route("/compile", methods=["POST"])
def compile_document():
    content = request.json.get("content", "#set page(width: 100pt)\nHello!")
    resp = requests.post(
        f"{API_URL}/compile",
        json={
            "documents": [{
                "mainTyp": base64.b64encode(content.encode()).decode(),
                "storeToS3": request.json.get("storeToS3", False),
            }],
        },
    )
    result = resp.json()

    if result.get("s3Url"):
        return jsonify(s3Url=result["s3Url"])
    if result.get("pdf"):
        return Response(
            base64.b64decode(result["pdf"]),
            mimetype="application/pdf",
            headers={"Content-Disposition": "attachment; filename=output.pdf"},
        )
    return jsonify(error=result.get("error", "Unknown error")), 500
```

## Run

```bash
flask --app app run
```
