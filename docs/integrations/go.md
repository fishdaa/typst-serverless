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
