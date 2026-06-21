package com.oneorthree.phone.auth.client;

public interface AppleJwksClient {
    String extractSubject(String idtntityToken);
}
