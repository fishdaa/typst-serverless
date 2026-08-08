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

export interface PosterSize {
  key: string
  label: string
  widthIn: number
  heightIn: number
}

/** Common large-format poster/banner sizes, in inches. */
export const POSTER_SIZES: PosterSize[] = [
  { key: '2x5', label: '2 x 5 ft (portrait banner)', widthIn: 24, heightIn: 60 },
  { key: '2x3', label: '2 x 3 ft', widthIn: 24, heightIn: 36 },
  { key: '3x4', label: '3 x 4 ft', widthIn: 36, heightIn: 48 },
  { key: '4x10', label: '4 x 10 ft (2x banner)', widthIn: 48, heightIn: 120 },
  { key: '6x15', label: '6 x 15 ft (3x banner)', widthIn: 72, heightIn: 180 },
  { key: '8x20', label: '8 x 20 ft (4x banner)', widthIn: 96, heightIn: 240 },
  { key: '10x25', label: '10 x 25 ft (5x banner)', widthIn: 120, heightIn: 300 }
]

export interface PosterData {
  title: string
  subtitle: string
  accent: string
}

export const POSTER_BATCH_DATA: PosterData[] = [
  { title: 'Booth A1', subtitle: 'Robotics & Automation', accent: '#2563eb' },
  { title: 'Booth B4', subtitle: 'Renewable Energy', accent: '#16a34a' },
  { title: 'Booth C2', subtitle: 'Biotech Research', accent: '#dc2626' }
]

/**
 * Large-format poster source. Rendered at full physical size (e.g. 24in x 60in)
 * with a full-bleed background image generated at the same pixel dimensions as
 * the poster itself — this is the workload the fishdaa/typst fork's
 * image-resampling fast path targets.
 */
export function posterTyp(size: PosterSize, data: PosterData): string {
  return `#set page(width: ${size.widthIn}in, height: ${size.heightIn}in, margin: 0in, fill: white)
#set text(font: "Liberation Sans")

#place(top + left, image("background.png", width: 100%, height: 100%))

#pad(1in)[
  #align(center + horizon)[
    #block(width: 100%, height: 6in, fill: rgb("${data.accent}"), radius: 12pt)[
      #align(center + horizon)[
        #text(size: 72pt, weight: "bold", fill: white)[${data.title}]
      ]
    ]
    #v(1in)
    #text(size: 36pt, fill: white)[${data.subtitle}]
    #v(2in)
    #image("logo.png", width: 3in)
  ]
]
`
}
