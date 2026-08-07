export const SIMPLE_DOC = `#set text(size: 12pt)
#set page(margin: 1in)

= Hello from Typst Serverless
This document was compiled on demand by a Lambda function running the
Typst compiler, with no server to manage.

- Edit the source on the left
- Hit Compile
- The PDF renders on the right
`

export const MULTI_FILE_MAIN = `#import "helpers.typ": greeting

#set text(size: 12pt)
#set page(margin: 1in)

= Multi-file document
#greeting("World")

This main document imports a helper module compiled alongside it via
\`extraTyps\`.
`

export const MULTI_FILE_EXTRA = `#let greeting(name) = [
  Hello, #name! This text comes from a second .typ file, imported into
  main.typ via extraTyps.
]
`

export const DATA_BINDING_DOC = `#set page(width: 320pt, height: 220pt, margin: 16pt)
#set text(size: 11pt)

#let data = json("data.json")

= Report: #data.title
Author: #data.author

#data.content
`

export const DATA_BINDING_JSON = JSON.stringify(
  {
    title: 'Quarterly Summary',
    author: 'typst-serverless demo',
    content: 'This paragraph is rendered from JSON data bound into the template at compile time. Edit the JSON on the left and recompile.'
  },
  null,
  2
)

export const OUTPUT_FORMATS_DOC = `#set page(width: 300pt, height: 200pt, margin: 16pt)
#set text(size: 14pt)

= Output formats
This same source compiles to PDF, SVG, or PNG — pick a format on the
left and recompile.
`

export const ASSET_DOC = `#set page(width: 260pt, height: 180pt, margin: 14pt)
#set text(size: 11pt)

= Asset from the library
#figure(
  image("logo.png", width: 48pt),
  caption: [Fetched from the shared asset store by path]
)
`

export const BATCH_DOCS = [
  '= Invoice 001\n\nCustomer: Acme Corp\nAmount: \\$120.00',
  '= Invoice 002\n\nCustomer: Globex Inc\nAmount: \\$85.50',
  '= Invoice 003\n\nCustomer: Initech\nAmount: \\$310.25'
]

export const WEBHOOK_DOC = `= Webhook test document
This compile was triggered with a webhook URL attached — check your
receiver for the delivered payload.
`
