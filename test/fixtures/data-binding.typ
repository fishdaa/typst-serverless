#set page(width: 100pt, height: 80pt)
// Requires data.json in same dir with Typst-compatible JSON (e.g. {"hello":"world"})
#let data = json("data.json")
Hello, #data.hello!
