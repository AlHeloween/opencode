import { Resvg } from '@resvg/resvg-js'
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#4CAF50" rx="10"/><text x="100" y="40" text-anchor="middle" fill="white" font-size="18" font-family="Arial">Vision Test</text><text x="100" y="70" text-anchor="middle" fill="#C8E6C9" font-size="14" font-family="Arial">What color is this?</text></svg>`
const png = new Resvg(svg).render().asPng()
await Bun.file('D:/zPython/opencode/.opencode/data/test-vision.png').write(png)
console.log('Written:', png.length, 'bytes')
