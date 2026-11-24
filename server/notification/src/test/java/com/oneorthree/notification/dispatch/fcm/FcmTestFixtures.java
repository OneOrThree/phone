package com.oneorthree.notification.dispatch.fcm;

import com.google.auth.oauth2.GoogleCredentials;
import com.oneorthree.notification.dispatch.PushTransport;
import io.micrometer.core.instrument.MeterRegistry;

public final class FcmTestFixtures {
    private FcmTestFixtures() {
    }

    public static FcmTransport transport(String project, GoogleCredentials credentials, String baseUrl,
            MeterRegistry registry) {
        return new FcmTransport(project, credentials, baseUrl, registry);
    }

    public static PushTransport.Result classify(int status, String body) {
        return FcmTransport.classify(status, body);
    }
}
