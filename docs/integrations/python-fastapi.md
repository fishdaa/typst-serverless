# Python + FastAPI

Generate PDFs from FastAPI by running `typst-serverless` via `subprocess` or AWS Lambda.

## Setup

```bash
pip install fastapi uvicorn
```

## Container mode

Basic route using Docker:

```python
import subprocess
import tempfile
import shutil
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI()
TYPST_IMAGE = "typst-serverless"


class CompileRequest(BaseModel):
    content: str
    outputFormat: str = "pdf"


@app.get("/pdf")
def get_pdf():
    """Generate a simple PDF"""
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
            raise HTTPException(
                status_code=500,
                detail="Compilation failed",
            )

        return Response(
            content=result.stdout,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=output.pdf"},
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@app.post("/compile")
def compile_document(req: CompileRequest):
    """Compile custom Typst content"""
    tmp = tempfile.mkdtemp(prefix="typst-")
    try:
        main_typ = Path(tmp) / "main.typ"
        main_typ.write_text(req.content)

        # Output format is inferred from TYPST_OUTPUT's extension, not a dedicated env var
        result = subprocess.run(
            [
                "docker", "run", "--rm",
                "-v", f"{tmp}:/workspace",
                "-e", "TYPST_WORKSPACE=/workspace",
                "-e", "TYPST_MAIN=main.typ",
                "-e", f"TYPST_OUTPUT=output.{req.outputFormat}",
                "-e", "TYPST_PIPE=true",
                TYPST_IMAGE,
            ],
            capture_output=True,
            timeout=30,
        )

        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Compilation failed: {result.stderr.decode()}",
            )

        media_types = {
            "pdf": "application/pdf",
            "svg": "image/svg+xml",
            "png": "image/png",
        }

        return Response(
            content=result.stdout,
            media_type=media_types.get(req.outputFormat, "application/octet-stream"),
            headers={
                "Content-Disposition": f"attachment; filename=output.{req.outputFormat}"
            },
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
```

## Lambda (AWS SDK)

If you've deployed the Lambda stack ([docs/lambda/](../lambda/README.md)):

### Basic setup

```bash
pip install boto3
```

### Simple example

```python
import boto3
import base64
import json
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI()
lambda_client = boto3.client("lambda")


class CompileRequest(BaseModel):
    content: str
    storeToS3: bool = False
    outputFormat: str = "pdf"


@app.post("/compile")
async def compile_typst(req: CompileRequest):
    """Compile Typst document via Lambda"""
    payload = {
        "action": "compile",
        "mainTyp": base64.b64encode(req.content.encode()).decode(),
        "storeToS3": req.storeToS3,
        "outputFormat": req.outputFormat,
    }
    
    try:
        resp = lambda_client.invoke(
            FunctionName="typst-compile-xxx",  # Replace with your function name
            Payload=json.dumps(payload),
        )
        result = json.loads(resp["Payload"].read())
        
        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
        
        if result.get("s3Url"):
            return {"s3Url": result["s3Url"]}
        
        if result.get("pdf"):
            pdf_bytes = base64.b64decode(result["pdf"])
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": "attachment; filename=output.pdf"},
            )
        
        raise HTTPException(status_code=500, detail="No output received")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### Advanced: Service with dependency injection

```python
# services/typst.py
import boto3
import base64
import json
from typing import Optional

class TypstService:
    def __init__(self, function_name: str, region: str = "us-east-1"):
        self.client = boto3.client("lambda", region_name=region)
        self.function_name = function_name
    
    def compile(
        self,
        content: str,
        store_to_s3: bool = False,
        output_format: str = "pdf",
        webhook: Optional[str] = None,
    ) -> dict:
        """Compile Typst content to PDF/SVG/PNG"""
        payload = {
            "action": "compile",
            "mainTyp": base64.b64encode(content.encode()).decode(),
            "storeToS3": store_to_s3,
            "outputFormat": output_format,
        }
        
        if webhook:
            payload["webhook"] = webhook
        
        resp = self.client.invoke(
            FunctionName=self.function_name,
            Payload=json.dumps(payload),
        )
        
        return json.loads(resp["Payload"].read())


# main.py
import os
from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel, HttpUrl
from services.typst import TypstService

app = FastAPI()


def get_typst_service() -> TypstService:
    """Dependency for Typst service"""
    return TypstService(
        function_name=os.getenv("TYPST_LAMBDA_FUNCTION", "typst-compile-xxx"),
        region=os.getenv("AWS_REGION", "us-east-1"),
    )


class CompileRequest(BaseModel):
    content: str
    storeToS3: bool = False
    outputFormat: str = "pdf"
    webhook: HttpUrl | None = None


@app.post("/compile")
async def compile_document(
    req: CompileRequest,
    typst: TypstService = Depends(get_typst_service),
):
    """Compile Typst document"""
    try:
        result = typst.compile(
            content=req.content,
            store_to_s3=req.storeToS3,
            output_format=req.outputFormat,
            webhook=str(req.webhook) if req.webhook else None,
        )
        
        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
        
        if result.get("s3Url"):
            return {"s3Url": result["s3Url"], "documentId": result.get("documentId")}
        
        if result.get("pdf"):
            return {
                "documentId": result.get("documentId"),
                "pdf": result["pdf"],  # base64
            }
        
        raise HTTPException(status_code=500, detail="No output received")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Compilation error: {str(e)}")


@app.get("/status/{document_id}")
async def get_status(
    document_id: str,
    typst: TypstService = Depends(get_typst_service),
):
    """Check compilation status"""
    payload = {
        "action": "status",
        "documentId": document_id,
    }
    
    resp = typst.client.invoke(
        FunctionName=typst.function_name,
        Payload=json.dumps(payload),
    )
    
    result = json.loads(resp["Payload"].read())
    return result
```

## REST API (HTTP POST)

If API Gateway is enabled ([docs/api/](../api/README.md)), skip boto3 entirely and call the HTTP endpoint:

```bash
pip install httpx
```

```python
import base64
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI()
API_URL = "https://xxxx.execute-api.us-east-1.amazonaws.com"


class CompileRequest(BaseModel):
    content: str
    storeToS3: bool = False


@app.post("/compile")
async def compile_via_rest(req: CompileRequest):
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{API_URL}/compile",
            json={
                "documents": [{
                    "mainTyp": base64.b64encode(req.content.encode()).decode(),
                    "storeToS3": req.storeToS3,
                }],
            },
        )
    result = resp.json()

    if result.get("s3Url"):
        return {"s3Url": result["s3Url"]}
    if result.get("pdf"):
        return Response(
            content=base64.b64decode(result["pdf"]),
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=output.pdf"},
        )
    raise HTTPException(status_code=500, detail=result.get("error", "Unknown error"))


@app.get("/status/{document_id}")
async def get_status_via_rest(document_id: str):
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{API_URL}/status/{document_id}")
    return resp.json()
```

## Run

```bash
uvicorn app:app --reload
```
