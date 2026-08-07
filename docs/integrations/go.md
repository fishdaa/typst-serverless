# Go

Generate PDFs from Go (net/http, Chi, Echo) by running `typst-serverless` via `os/exec`.

## Setup

```go
go mod init myapp
// Add chi or echo if desired:
// go get github.com/go-chi/chi/v5
// go get github.com/labstack/echo/v4
```

## net/http

```go
package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
)

const typstImage = "typst-serverless"

func pdfHandler(w http.ResponseWriter, r *http.Request) {
	tmp, err := os.MkdirTemp("", "typst-")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(tmp)

	mainTyp := filepath.Join(tmp, "main.typ")
	if err := os.WriteFile(mainTyp, []byte("#hello(world)\n"), 0644); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	cmd := exec.Command("docker", "run", "--rm",
		"-v", fmt.Sprintf("%s:/workspace", tmp),
		"-e", "TYPST_WORKSPACE=/workspace",
		"-e", "TYPST_MAIN=main.typ",
		"-e", "TYPST_PIPE=true",
		typstImage,
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		http.Error(w, "Compilation failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="output.pdf"`)
	io.Copy(w, bytes.NewReader(out))
}

func main() {
	http.HandleFunc("/pdf", pdfHandler)
	http.ListenAndServe(":3000", nil)
}
```

## Lambda (AWS SDK)

If you've deployed the Lambda stack ([docs/lambda/](../lambda/README.md)):

```go
import (
	"context"
	"encoding/base64"
	"encoding/json"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/lambda"
)

func compileViaLambda(ctx context.Context, typSource string) ([]byte, error) {
	cfg, _ := config.LoadDefaultConfig(ctx)
	client := lambda.NewFromConfig(cfg)
	payload := map[string]string{
		"action":  "compile",
		"mainTyp": base64.StdEncoding.EncodeToString([]byte(typSource)),
	}
	raw, _ := json.Marshal(payload)
	out, err := client.Invoke(ctx, &lambda.InvokeInput{
		FunctionName: aws.String("typst-compile-xxx"),
		Payload:      raw,
	})
	if err != nil {
		return nil, err
	}
	var result struct {
		PDF string `json:"pdf"`
	}
	json.Unmarshal(out.Payload, &result)
	return base64.StdEncoding.DecodeString(result.PDF)
}
```

## REST API (HTTP POST)

If API Gateway is enabled ([docs/api/](../api/README.md)), skip the AWS SDK entirely and call the HTTP endpoint:

```go
import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
)

type compileDoc struct {
	MainTyp    string `json:"mainTyp"`
	StoreToS3  bool   `json:"storeToS3"`
}

type compileRequest struct {
	Documents []compileDoc `json:"documents"`
}

type compileResponse struct {
	Pdf    string `json:"pdf"`
	S3Url  string `json:"s3Url"`
	Error  string `json:"error"`
}

func compileViaRest(apiUrl, typSource string) (*compileResponse, error) {
	body, _ := json.Marshal(compileRequest{
		Documents: []compileDoc{{
			MainTyp:   base64.StdEncoding.EncodeToString([]byte(typSource)),
			StoreToS3: false,
		}},
	})
	resp, err := http.Post(apiUrl+"/compile", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result compileResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}
```

## Chi

```go
r := chi.NewRouter()
r.Get("/pdf", pdfHandler)
http.ListenAndServe(":3000", r)
```

## Echo

```go
e := echo.New()
e.GET("/pdf", func(c echo.Context) error {
	// Use same pdfHandler logic, return c.Blob(200, "application/pdf", out)
	return nil
})
e.Logger.Fatal(e.Start(":3000"))
```
