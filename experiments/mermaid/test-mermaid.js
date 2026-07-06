const { renderMermaidToText } = require('./src/util/mermaid')

const result = renderMermaidToText('sequenceDiagram\n  Alice->>Bob: Hello Bob!\n  Bob-->>Alice: Hi Alice!', { theme: 'dark' })
console.log(result ? 'SUCCESS' : 'FAILED')
if (result) console.log(result.slice(0, 200))
