import { BinaryHandler } from "./binary"
import { ImageHandler } from "./image"
import { DocumentHandler } from "./document"
import { AudioHandler } from "./audio"
import { VideoHandler } from "./video"
import { TextHandler, CodeHandler } from "./text"
import { SensorHandler } from "./sensor"
import { SpatialHandler } from "./spatial"
import { ArchiveHandler } from "./archive"
import { DataHandler } from "./data"
import { SpreadsheetHandler } from "./spreadsheet"
import { PresentationHandler } from "./presentation"
import { ImageVectorHandler } from "./image_vector"
import { registry } from "../registry"

// Register all 14 built-in handlers
registry.register(BinaryHandler)
registry.register(ImageHandler)
registry.register(DocumentHandler)
registry.register(AudioHandler)
registry.register(VideoHandler)
registry.register(TextHandler)
registry.register(CodeHandler)
registry.register(SensorHandler)
registry.register(SpatialHandler)
registry.register(ArchiveHandler)
registry.register(DataHandler)
registry.register(SpreadsheetHandler)
registry.register(PresentationHandler)
registry.register(ImageVectorHandler)

export {
  BinaryHandler, ImageHandler, DocumentHandler,
  AudioHandler, VideoHandler, TextHandler, CodeHandler,
  SensorHandler, SpatialHandler, ArchiveHandler,
  DataHandler, SpreadsheetHandler, PresentationHandler,
  ImageVectorHandler,
}
