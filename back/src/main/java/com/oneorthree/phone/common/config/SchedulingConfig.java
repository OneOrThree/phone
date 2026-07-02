package com.oneorthree.phone.common.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

// 스케줄러 인프라 활성화 진입점 (@Scheduled 사용을 위한 설정)
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
