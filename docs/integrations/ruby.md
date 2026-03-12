# Ruby

Generate PDFs from Ruby (Rails, Sinatra) by running `typst-serverless` via `Open3` or `system`.

## Lambda (AWS SDK)

If you've deployed the Lambda stack ([docs/lambda/](../lambda/README.md)):

```ruby
require "aws-sdk-lambda"

client = Aws::Lambda::Client.new(region: "us-east-1")
payload = {
  action: "compile",
  mainTyp: Base64.strict_encode64("#set page(width: 100pt)\nHello!"),
}
resp = client.invoke(function_name: "typst-compile-xxx", payload: payload.to_json)
result = JSON.parse(resp.payload.string)
# result["pdf"] = base64 PDF, or result["s3Url"] if storeToS3
```

## Sinatra

```bash
gem install sinatra
```

```ruby
require "sinatra"
require "open3"
require "tempfile"

TYPST_IMAGE = "typst-serverless"

get "/pdf" do
  Dir.mktmpdir("typst-") do |tmp|
    main_typ = File.join(tmp, "main.typ")
    File.write(main_typ, "#hello(world)\n")

    cmd = [
      "docker", "run", "--rm",
      "-v", "#{tmp}:/workspace",
      "-e", "TYPST_WORKSPACE=/workspace",
      "-e", "TYPST_MAIN=main.typ",
      "-e", "TYPST_PIPE=true",
      TYPST_IMAGE
    ]

    out, err, status = Open3.capture3(*cmd)
    if !status.success?
      status 500
      return { error: "Compilation failed" }.to_json
    end

    content_type "application/pdf"
    attachment "output.pdf"
    out
  end
end
```

## Rails

Add a controller action:

```ruby
# app/controllers/pdf_controller.rb
class PdfController < ApplicationController
  TYPST_IMAGE = "typst-serverless"

  def show
    Dir.mktmpdir("typst-") do |tmp|
      main_typ = File.join(tmp, "main.typ")
      File.write(main_typ, "#hello(world)\n")

      out, err, status = Open3.capture3(
        "docker", "run", "--rm",
        "-v", "#{tmp}:/workspace",
        "-e", "TYPST_WORKSPACE=/workspace",
        "-e", "TYPST_MAIN=main.typ",
        "-e", "TYPST_PIPE=true",
        TYPST_IMAGE
      )

      unless status.success?
        render json: { error: "Compilation failed" }, status: :internal_server_error
        return
      end

      send_data out, filename: "output.pdf", type: "application/pdf"
    end
  end
end
```

```ruby
# config/routes.rb
get "/pdf", to: "pdf#show"
```
