/**
 * TexturePlaneRenderable — renders an image as a textured 3D plane in the OpenTUI tree.
 *
 * Wraps @opentui/core/3d ThreeRenderable for async texture loading.
 * The ThreeRenderable is added as a child — the render tree calls its
 * render() method which handles the Three.js → OptimizedBuffer pipeline.
 *
 * Registered as <image-plane> via extend().
 */
import { Renderable, type RenderContext, type RenderableOptions } from "@opentui/core"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.renderable.image-plane" })

export interface TexturePlaneOptions extends RenderableOptions<TexturePlaneRenderable> {
  url: string
  mime?: string
}

export class TexturePlaneRenderable extends Renderable {
  private url: string
  private mime: string
  private loading = true
  private errorMsg: string | null = null

  constructor(ctx: RenderContext, options: TexturePlaneOptions) {
    super(ctx, options)
    this.url = options.url
    this.mime = options.mime ?? "image/png"

    // Start async setup — when complete, ThreeRenderable is added as a child
    this.setupScene(ctx)

    log.debug("TexturePlaneRenderable: created", { urlPrefix: this.url.substring(0, 40) })
  }

  private async setupScene(ctx: RenderContext): Promise<void> {
    try {
      const [THREE, opentui3d] = await Promise.all([
        import("three"),
        import("@opentui/core/3d"),
      ])
      const { TextureUtils, ThreeRenderable, SuperSampleType } = opentui3d as any

      // --- Decode data URL to temp file ---
      const { writeFileSync, unlinkSync, existsSync } = await import("fs")
      const { tmpdir } = await import("os")
      const { join } = await import("path")

      const base64 = this.url.split(",")[1]
      if (!base64 || base64.length === 0) {
        this.errorMsg = "No base64 data"
        this.loading = false
        return
      }

      const ext = this.mime === "image/jpeg" ? ".jpg" : ".png"
      const tmpFile = join(tmpdir(), `opencode_plane_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`)
      writeFileSync(tmpFile, Buffer.from(base64, "base64"))

      try {
        // --- Load texture ---
        const texture = await TextureUtils.loadTextureFromFile(tmpFile)
        if (!texture) {
          this.errorMsg = "Failed to load texture"
          this.loading = false
          return
        }

        const texW = texture.image.width as number
        const texH = texture.image.height as number
        const aspect = texH > 0 ? texW / texH : 1
        const pw = this.width ?? 60
        const ph = pw / aspect

        // --- Build Three.js scene ---
        const T = THREE as any
        const geometry = new T.PlaneGeometry(pw, ph)
        const material = new T.MeshBasicMaterial({ map: texture })
        const mesh = new T.Mesh(geometry, material)
        const scene = new T.Scene()
        scene.add(mesh)
        const camera = new T.PerspectiveCamera(45, pw / Math.max(ph, 1), 0.1, 1000)
        camera.position.z = ph / (2 * Math.tan((45 * Math.PI) / 360))

        // --- Create ThreeRenderable as a child ---
        const threeRenderable = new ThreeRenderable(ctx, {
          scene,
          camera,
          renderer: {
            superSample: SuperSampleType.GPU,
            alpha: false,
          },
          autoAspect: false,
        })

        // Add as child — the render tree will call render() which calls renderSelf()
        this.add(threeRenderable)

        this.loading = false
        log.debug("TexturePlaneRenderable: scene ready", { texW, texH, pw, ph })
      } finally {
        try { if (existsSync(tmpFile)) unlinkSync(tmpFile) } catch { /* cleanup */ }
      }
    } catch (err) {
      this.errorMsg = String(err)
      this.loading = false
      log.warn("bug: TexturePlaneRenderable setup failed", { error: String(err) })
    }
  }
}
