// Typst document with multiple image assets.
// Requires: logo.png, fish.jpg (see images/README.md)
#set page(width: 220pt, height: 200pt, margin: 12pt)
#set text(size: 11pt)
#set par(justify: true)

#let data = json("data.json")
= Report: #data.title
Author: #data.author

#figure(
  image("logo.png", width: 30pt),
  caption: [Minimal logo]
)

#figure(
  image("fish.jpg", width: 60pt),
  caption: [Fish sample]
)

#data.content
