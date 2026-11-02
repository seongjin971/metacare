import CoreGraphics
import ExpoModulesCore
import Foundation
import ImageIO
import Vision

public class MedicationPhotoAnalyzerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MedicationPhotoAnalyzer")

    AsyncFunction("analyzePhoto") { (uri: String, promise: Promise) in
      let result = PhotoAnalysisResult(promise)
      do {
        let url = try self.checkedFile(uri)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let originalWidth = properties[kCGImagePropertyPixelWidth] as? Int,
              let originalHeight = properties[kCGImagePropertyPixelHeight] as? Int,
              (1...20000).contains(originalWidth), (1...20000).contains(originalHeight) else {
          throw PhotoAnalysisException()
        }
        let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
        let swapped = [5, 6, 7, 8].contains(orientation)
        let width = swapped ? originalHeight : originalWidth
        let height = swapped ? originalWidth : originalHeight
        let options: [CFString: Any] = [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: 2048,
          kCGImageSourceShouldCacheImmediately: true
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
          throw PhotoAnalysisException()
        }
        let quality = try self.measureQuality(image)
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let supported = try request.supportedRecognitionLanguages()
        guard supported.contains("ko-KR") else { throw RecognitionUnavailableException() }
        request.recognitionLanguages = ["ko-KR", "en-US"].filter { supported.contains($0) }
        let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
        let deadline = DispatchWorkItem {
          result.reject(PhotoAnalysisTimeoutException())
          request.cancel()
        }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 15, execute: deadline)
        defer { deadline.cancel() }
        do {
          try handler.perform([request])
        } catch {
          // Deliberately omit the OCR text and source URI from errors and logs.
          throw PhotoAnalysisException()
        }
        let text = (request.results ?? []).compactMap { observation in
          observation.topCandidates(1).first?.string
        }.joined(separator: "\n")
        result.resolve([
          "text": String(text.prefix(20000)),
          "width": width,
          "height": height,
          "meanLuminance": quality.mean,
          "darkPixelRatio": quality.darkRatio,
          "blurScore": quality.laplacianVariance
        ])
      } catch {
        result.reject(error as? Exception ?? PhotoAnalysisException())
      }
    }
  }

  private func checkedFile(_ value: String) throws -> URL {
    guard let original = URL(string: value), original.isFileURL,
          original.host == nil || original.host == "",
          original.query == nil, original.fragment == nil else { throw PhotoAnalysisException() }
    let url = original.standardizedFileURL.resolvingSymlinksInPath()
    let root = URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().path + "/"
    guard url.path.hasPrefix(root),
          let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
          attributes[.type] as? FileAttributeType == .typeRegular,
          let size = attributes[.size] as? NSNumber,
          size.int64Value > 0, size.int64Value <= 32 * 1024 * 1024 else { throw PhotoAnalysisException() }
    return url
  }

  private struct Quality {
    let mean: Double
    let darkRatio: Double
    let laplacianVariance: Double
  }

  private func measureQuality(_ image: CGImage) throws -> Quality {
    let scale = min(1.0, 320.0 / Double(max(image.width, image.height)))
    let width = max(1, Int((Double(image.width) * scale).rounded()))
    let height = max(1, Int((Double(image.height) * scale).rounded()))
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let rendered = pixels.withUnsafeMutableBytes { bytes -> Bool in
      guard let context = CGContext(
        data: bytes.baseAddress, width: width, height: height,
        bitsPerComponent: 8, bytesPerRow: width * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
      ) else { return false }
      context.interpolationQuality = .medium
      context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
      return true
    }
    guard rendered else { throw PhotoAnalysisException() }
    let count = width * height
    var gray = [Double](repeating: 0, count: count)
    var total = 0.0
    var dark = 0
    for index in 0..<count {
      let offset = index * 4
      let value = 0.299 * Double(pixels[offset]) + 0.587 * Double(pixels[offset + 1]) + 0.114 * Double(pixels[offset + 2])
      gray[index] = value
      total += value
      if value < 32.0 { dark += 1 }
    }
    var sum = 0.0
    var squared = 0.0
    var innerCount = 0
    if width > 2 && height > 2 {
      for y in 1..<(height - 1) {
        for x in 1..<(width - 1) {
          let index = y * width + x
          let laplacian = gray[index - 1] + gray[index + 1] + gray[index - width] + gray[index + width] - 4.0 * gray[index]
          sum += laplacian
          squared += laplacian * laplacian
          innerCount += 1
        }
      }
    }
    let mean = innerCount == 0 ? 0.0 : sum / Double(innerCount)
    let variance = innerCount == 0 ? 0.0 : max(0.0, squared / Double(innerCount) - mean * mean)
    return Quality(mean: total / Double(count), darkRatio: Double(dark) / Double(count), laplacianVariance: variance)
  }
}

private final class PhotoAnalysisException: Exception {
  override var reason: String { "촬영한 사진을 확인하지 못했어요. 다시 촬영해 주세요." }
}

private final class RecognitionUnavailableException: Exception {
  override var reason: String { "이 기기에서 약봉투 글자를 확인할 수 없어요." }
}

private final class PhotoAnalysisTimeoutException: Exception {
  override var reason: String { "사진 확인이 지연되고 있어요. 잠시 후 다시 촬영해 주세요." }
}

// Recognition and its deadline may race. Only one result can reach JavaScript.
private final class PhotoAnalysisResult: @unchecked Sendable {
  private let promise: Promise
  private let lock = NSLock()
  private var settled = false

  init(_ promise: Promise) { self.promise = promise }

  private func claim() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if settled { return false }
    settled = true
    return true
  }

  func resolve(_ value: [String: Any]) {
    if claim() { promise.resolve(value) }
  }

  func reject(_ error: Exception) {
    if claim() { promise.reject(error) }
  }
}
