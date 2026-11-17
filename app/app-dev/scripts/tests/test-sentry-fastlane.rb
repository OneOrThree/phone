# 실제 Fastfile을 읽되 빌드·네트워크·Apple 업로드는 대역으로 바꿔 호출 순서를 검사한다.
require "minitest/autorun"

module SharedValues
  XCODEBUILD_ARCHIVE = :archive
end

module UI
  def self.user_error!(message)
    raise message
  end
end

class FastlaneFixture
  def self.default_platform(*) = nil
  def self.opt_out_usage = nil
  def self.platform(*) = nil
  class_eval(File.read(File.expand_path("../../ios/fastlane/Fastfile", __dir__)),
             File.expand_path("../../ios/fastlane/Fastfile", __dir__))
end

class ReleaseLane < FastlaneFixture
  attr_accessor :failure, :archive
  attr_reader :calls

  def initialize
    @calls = []
    @archive = "/tmp/Cattus test.xcarchive"
  end

  def sh(*args)
    @calls << args[2]
    raise "Sentry failed" if args[2] == failure
  end

  def asc_api_key = {}
  def compute_build_number(*) = 14
  def increment_build_number(*) = nil
  def build_app(*) = @calls << "build"
  def lane_context = { SharedValues::XCODEBUILD_ARCHIVE => archive }
  def upload_to_testflight(*) = @calls << "Apple"
end

class SentryFastlaneTest < Minitest::Test
  def setup
    @lane = ReleaseLane.new
    @previous = ENV.to_h
    %w[EXPO_PUBLIC_DATADOG_APPLICATION_ID EXPO_PUBLIC_DATADOG_CLIENT_TOKEN
       ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID].each { |name| ENV[name] = "test-placeholder" }
  end

  def teardown
    ENV.replace(@previous)
  end

  def test_auth_failure_stops_before_build
    @lane.failure = "check-release"
    assert_raises(RuntimeError) { @lane.archive_and_upload }
    assert_equal ["check-release"], @lane.calls
  end

  def test_symbol_failure_prevents_apple_upload
    @lane.failure = "archive"
    assert_raises(RuntimeError) { @lane.archive_and_upload }
    assert_equal ["check-release", "build", "archive"], @lane.calls
  end

  def test_missing_archive_prevents_apple_upload
    @lane.archive = nil
    assert_raises(RuntimeError) { @lane.archive_and_upload }
    assert_equal ["check-release", "build"], @lane.calls
  end

  def test_apple_upload_only_after_symbol_success
    assert_equal 14, @lane.archive_and_upload
    assert_equal ["check-release", "build", "archive", "Apple"], @lane.calls
  end
end
