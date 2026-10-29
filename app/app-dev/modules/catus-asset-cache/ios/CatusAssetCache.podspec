Pod::Spec.new do |s|
  s.name = 'CatusAssetCache'
  s.version = '1.0.0'
  s.summary = '검증된 CDN 에셋과 불변 스냅샷 캐시'
  s.description = '제한 수신, SHA-256 검증, 파일 flush를 제공하는 로컬 Expo 모듈'
  s.license = { :type => 'Private' }
  s.author = 'oneorthree'
  s.homepage = 'https://github.com/OneOrThree/phone'
  s.source = { :git => 'https://github.com/OneOrThree/phone.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
