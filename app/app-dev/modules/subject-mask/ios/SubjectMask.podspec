Pod::Spec.new do |s|
  s.name           = 'SubjectMask'
  s.version        = '0.1.0'
  s.summary        = '사진 피사체 누끼(Vision foreground instance mask) 로컬 네이티브 모듈'
  s.description    = '오브젝트 캐릭터 스파이크 — iOS 17+ Vision으로 피사체만 잘라 투명 PNG로 저장한다.'
  s.author         = 'oneorthree'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
