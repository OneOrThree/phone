#!/bin/sh
set -eu
# 운영 앱과 별도 진입점. Spring Boot 서버·스케줄러를 시작하지 않는다.
exec java -Dloader.main=com.oneorthree.notification.NotificationReleaseBridge \
  -cp /app/app.jar org.springframework.boot.loader.launch.PropertiesLauncher "$@"
