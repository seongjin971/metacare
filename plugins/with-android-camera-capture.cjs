const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

// expo-camera 58 returns a generated timestamp bitmap on Android emulators.
// CameraX can capture the configured emulator camera (virtual scene or webcam).
const takePicture = '      AsyncFunction("takePicture") { view: ExpoCameraView, options: PictureOptions, promise: Promise ->';
const end = '      }.runOnQueue(Queues.MAIN)';
const upstream = `${takePicture}
        if (!EmulatorUtilities.isRunningOnEmulator()) {
          view.takePicture(options, promise, cacheDirectory, runtime)
        } else {
          val image = CameraViewHelper.generateSimulatorPhoto(view.width, view.height)
          moduleScope.launch {
            ResolveTakenPicture(image, promise, options, false, runtime, cacheDirectory) { response ->
              view.onPictureSaved(response)
            }.resolve()
          }
        }
${end}`;
const cameraCapture = `${takePicture}
        view.takePicture(options, promise, cacheDirectory, runtime)
${end}`;

module.exports = config => withDangerousMod(config, ['android', async mod => {
  const manifest = require.resolve('expo-camera/package.json', { paths: [mod.modRequest.projectRoot] });
  const { version } = JSON.parse(await fs.readFile(manifest, 'utf8'));
  const unsupported = `Review with-android-camera-capture.cjs for expo-camera@${version} before building Android.`;
  if (version !== '58.0.14') throw new Error(unsupported);

  const source = path.join(path.dirname(manifest), 'android/src/main/java/expo/modules/camera/CameraViewModule.kt');
  const original = await fs.readFile(source, 'utf8');
  const text = original.replaceAll('\r\n', '\n');
  if (text.split(takePicture).length !== 2) throw new Error(unsupported);
  if (text.includes(cameraCapture)) return mod;
  if (!text.includes(upstream)) throw new Error(unsupported);
  const result = text.replace(upstream, cameraCapture);
  await fs.writeFile(source, original.includes('\r\n') ? result.replaceAll('\n', '\r\n') : result);
  return mod;
}]);
