/**
 * TexturePlaneRenderable — renders an image as a textured 3D plane in the OpenTUI tree.
 *
 * Uses @opentui/three ThreeRenderable internally for GPU → block-char conversion.
 * Three.js is a static import — required for standalone binary bundling.
 *
 * Registered as <image-plane> via extend() in app.tsx.
 */
import { Renderable, type RenderContext, type RenderableOptions } from "@opentui/core"
import * as THREE from "three"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.renderable.image-plane" })

export interface TexturePlaneOptions extends RenderableOptions<TexturePlaneRenderable> {
  url: string
  mime?: string
}

export class TexturePlaneRenderable extends Renderable {
  private url: string
  private mime: string
  private childAdded = false

  constructor(ctx: RenderContext, options: TexturePlaneOptions) {
    super(ctx, options)
    this.url = options.url
    this.mime = options.mime ?? "image/png"
    // Default height for portrait images (492×960 → ~0.5 aspect)
    if (!options.height) this.height = Math.round((this.width || 70) / 0.5)
    this.setup(ctx)
  }

  private async setup(ctx: RenderContext): Promise<void> {
    try {
      const opentui3d = await import("@opentui/three")
      const { TextureUtils, ThreeRenderable, SuperSampleType } = opentui3d as any

      const { writeFileSync, unlinkSync, existsSync } = await import("fs")
      const { tmpdir } = await import("os")
      const { join } = await import("path")

      const base64 = this.url.split(",")[1]
      if (!base64 || base64.length === 0) return

      const ext = this.mime === "image/jpeg" ? ".jpg" : ".png"
      const tmpFile = join(tmpdir(), `opencode_plane_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`)
      writeFileSync(tmpFile, Buffer.from(base64, "base64"))

      try {
        const texture = await TextureUtils.loadTextureFromFile(tmpFile)
        if (!texture) return

        const texW = texture.image.width as number
        const texH = texture.image.height as number
        const aspect = texH > 0 ? texW / texH : 1
        const pw = this.width
        const ph = Math.round(pw / aspect)
        this.height = ph

        const geometry = new (THREE as any).PlaneGeometry(pw, ph)
        const material = new (THREE as any).MeshBasicMaterial({ map: texture })
        const mesh = new (THREE as any).Mesh(geometry, material)
        const scene = new (THREE as any).Scene()
        scene.add(mesh)
        const camera = new (THREE as any).PerspectiveCamera(45, pw / Math.max(ph, 1), 0.1, 1000)
        camera.position.z = ph / (2 * Math.tan((45 * Math.PI) / 360))

        const renderable = new ThreeRenderable(ctx, {
          scene,
          camera,
          width: pw,
          height: ph,
          renderer: { superSample: SuperSampleType.GPU, alpha: false },
          autoAspect: false,
        })
        if (this.isDestroyed) return

        this.add(renderable)
        this.childAdded = true
        this.requestRender()
        log.debug("TexturePlaneRenderable: child ready", { pw, ph })
      } finally {
        try { if (existsSync(tmpFile)) unlinkSync(tmpFile) } catch { /* cleanup */ }
      }
    } catch (err) {
      log.warn("bug: TexturePlaneRenderable setup failed", { error: String(err) })
    }
  }
}
