// Typst document for integration tests.
// Requires: logo.png (image asset), data.json (template data)
#set page(width: 200pt, height: 180pt, margin: 12pt)
#set text(size: 11pt)
#set par(justify: true)

#let data = json("data.json")
= Report: #data.title
Author: #data.author

#figure(
  image("logo.png", width: 40pt),
  caption: [Asset test]
)

#data.content
