require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'NeotreeDownloads'
  s.version        = package['version']
  s.summary        = 'Saves Superset exports from the Neotree Analytics WebView'
  s.description    = 'Receives WebView-generated exports and hands them to the iOS share sheet.'
  s.license        = 'UNLICENSED'
  s.author         = 'Neotree'
  s.homepage       = 'https://neotree.org'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
