// Makes media/mark.png, kernl's mark as a single-color shape, from the app-icon logo (kernl.png):
// the logo's light glyph becomes opaque and everything else (the dark tile, the margin) transparent.
// VS Code and the panel paint it with the theme's color, as they do their own icons.
// Run after changing kernl.png: swift scripts/logo-mark.swift kernl.png media/mark.png
// and, for light themes (where VS Code shows an extension's image icon as drawn), a dark copy:
// swift scripts/logo-mark.swift kernl.png media/mark-light.png dark
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3 || (args.count == 4 && args[3] == "dark") else {
  FileHandle.standardError.write("usage: swift scripts/logo-mark.swift <logo.png> <mark.png> [dark]\n".data(using: .utf8)!)
  exit(2)
}
guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
      let logo = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
  FileHandle.standardError.write("Expected a readable PNG at \(args[1])\n".data(using: .utf8)!)
  exit(1)
}

let width = logo.width, height = logo.height
var pixels = [UInt8](repeating: 0, count: width * height * 4)
let rgb = CGColorSpaceCreateDeviceRGB()
let premultiplied = CGImageAlphaInfo.premultipliedLast.rawValue
let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: rgb, bitmapInfo: premultiplied)!
context.draw(logo, in: CGRect(x: 0, y: 0, width: width, height: height))

// Coverage: how light the pixel is, where the logo is opaque (premultiplied, so dark or clear = 0).
var coverage = [UInt8](repeating: 0, count: width * height)
var minX = width, minY = height, maxX = -1, maxY = -1
for y in 0..<height {
  for x in 0..<width {
    let i = (y * width + x) * 4
    let light = (Int(pixels[i]) * 299 + Int(pixels[i + 1]) * 587 + Int(pixels[i + 2]) * 114) / 1000
    // Below a quarter of full white is the tile's dark gray (and its anti-aliased edge): not glyph.
    let value = UInt8(max(0, min(255, (light - 64) * 255 / 191)))
    coverage[y * width + x] = value
    if value > 32 {
      minX = min(minX, x); maxX = max(maxX, x)
      minY = min(minY, y); maxY = max(maxY, y)
    }
  }
}
guard maxX >= 0 else {
  FileHandle.standardError.write("Expected a light glyph on the logo's dark tile, found none\n".data(using: .utf8)!)
  exit(1)
}

// A square canvas around the glyph with a small margin, scaled to 256 px (sharp down to 13 px).
let side = 256
let glyph = max(maxX - minX + 1, maxY - minY + 1)
let scale = Double(side) * 0.92 / Double(glyph)
let offsetX = (Double(side) - Double(maxX - minX + 1) * scale) / 2
let offsetY = (Double(side) - Double(maxY - minY + 1) * scale) / 2
var mark = [UInt8](repeating: 0, count: side * side * 4)
for y in 0..<side {
  for x in 0..<side {
    // Nearest source pixel, averaged over the block it covers (simple box filter).
    let sx0 = Double(minX) + (Double(x) - offsetX) / scale, sy0 = Double(minY) + (Double(y) - offsetY) / scale
    let step = 1 / scale
    var sum = 0, count = 0
    var sy = sy0
    while sy < sy0 + step {
      var sx = sx0
      while sx < sx0 + step {
        let ix = Int(sx), iy = Int(sy)
        if ix >= 0, iy >= 0, ix < width, iy < height { sum += Int(coverage[iy * width + ix]) }
        count += 1
        sx += 1
      }
      sy += 1
    }
    let alpha = UInt8(count > 0 ? sum / count : 0)
    let i = (y * side + x) * 4
    // White (or, with "dark", VS Code's light-theme icon gray #424242), premultiplied by its coverage.
    let shade = args.count == 4 ? UInt8(Int(alpha) * 0x42 / 255) : alpha
    mark[i] = shade; mark[i + 1] = shade; mark[i + 2] = shade; mark[i + 3] = alpha
  }
}

let out = CGContext(data: &mark, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4, space: rgb, bitmapInfo: premultiplied)!
let image = out.makeImage()!
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else {
  FileHandle.standardError.write("Could not write \(args[2])\n".data(using: .utf8)!)
  exit(1)
}
print("wrote \(args[2]) (\(side)x\(side)) from the glyph at \(minX),\(minY) \(maxX - minX + 1)x\(maxY - minY + 1) in \(width)x\(height)")
