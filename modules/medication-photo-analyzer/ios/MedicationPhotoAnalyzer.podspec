Pod::Spec.new do |s|
  s.name = 'MedicationPhotoAnalyzer'
  s.version = '1.0.0'
  s.summary = 'Local photo quality measurements and text recognition for MetaCare'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'MetaCare'
  s.homepage = 'https://expo.dev'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => 'https://expo.dev' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'ImageIO', 'CoreGraphics'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
