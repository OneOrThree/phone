package com.oneorthree.realtime;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.InputStream;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/** 실제 Tomcat의 최종 협상까지 확인한다. Spring의 selectedExtensions만 검사하면 재협상을 놓친다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "chat.websocket.allowed-origins=https://allowed.example")
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class WebSocketCompressionIntegrationTest {

    @LocalServerPort
    private int port;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @ParameterizedTest
    @MethodSource("extensionOffers")
    @DisplayName("두 STOMP 경로는 정상·비정상 확장 제안과 무관하게 비압축 CONNECT·DISCONNECT·정상 종료한다")
    void offeredExtensionsDoNotChangeStompOrNormalClose(String path, String offer) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(10_000);
            Map<String, String> headers = handshake(socket, path, "https://allowed.example", offer);
            assertThat(headers.get("status")).contains("101");
            assertThat(headers).doesNotContainKey("sec-websocket-extensions");
            assertThat(headers.get("sec-websocket-protocol")).isEqualTo("v12.stomp");

            // React Native는 binary STOMP, 다른 클라이언트는 text STOMP를 보낼 수 있다.
            send(socket, offer != null ? 2 : 1, ("CONNECT\naccept-version:1.2\nhost:localhost\nheart-beat:0,0\n"
                    + "Authorization:" + bearer() + "\n\n\0").getBytes(StandardCharsets.UTF_8));
            Frame connected = read(socket.getInputStream());
            assertThat(connected.text()).startsWith("CONNECTED\n").contains("version:1.2\n");
            send(socket, 1, "DISCONNECT\nreceipt:closed\n\n\0".getBytes(StandardCharsets.UTF_8));
            Frame receipt = read(socket.getInputStream());
            assertThat(receipt.text()).startsWith("RECEIPT\n").contains("receipt-id:closed\n");
            send(socket, 8, ByteBuffer.allocate(2).putShort((short) 1000).array());
            Frame close = read(socket.getInputStream());
            assertThat(close.opcode()).isEqualTo(8);
            assertThat(ByteBuffer.wrap(close.payload()).getShort()).isEqualTo((short) 1000);
        }
    }

    private static Stream<Arguments> extensionOffers() {
        return Stream.of("/ws/chat", "/ws/realtime").flatMap(path -> Stream.of(
                null,
                "permessage-deflate; client_max_window_bits",
                "x\", permessage-deflate",
                "x\", permessage-deflate, \"y"
        ).map(offer -> Arguments.of(path, offer)));
    }

    @Test
    @DisplayName("확장 협상 제외가 기존 Origin 거부를 우회하지 않는다")
    void disallowedOriginStillFails() throws Exception {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(10_000);
            assertThat(handshake(socket, "/ws/realtime", "https://denied.example", "permessage-deflate").get("status"))
                    .contains("403");
        }
    }

    private Map<String, String> handshake(Socket socket, String path, String origin, String offer) throws Exception {
        String request = "GET " + path + " HTTP/1.1\r\nHost:localhost:" + port
                + "\r\nUpgrade:websocket\r\nConnection:Upgrade\r\nSec-WebSocket-Version:13\r\n"
                + "Sec-WebSocket-Key:dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol:v12.stomp\r\nOrigin:" + origin
                + (offer != null ? "\r\nSec-WebSocket-Extensions:" + offer : "") + "\r\n\r\n";
        socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        while (!bytes.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) {
            bytes.write(required(socket.getInputStream()));
            assertThat(bytes.size()).isLessThan(16_384);
        }
        String[] lines = bytes.toString(StandardCharsets.US_ASCII).split("\r\n");
        Map<String, String> result = new LinkedHashMap<>();
        result.put("status", lines[0]);
        for (int index = 1; index < lines.length; index++) {
            int colon = lines[index].indexOf(':');
            result.put(lines[index].substring(0, colon).toLowerCase(Locale.ROOT), lines[index].substring(colon + 1).trim());
        }
        return result;
    }

    private static void send(Socket socket, int opcode, byte[] payload) throws Exception {
        ByteArrayOutputStream frame = new ByteArrayOutputStream();
        frame.write(0x80 | opcode);
        if (payload.length < 126) {
            frame.write(0x80 | payload.length);
        } else {
            frame.write(0x80 | 126);
            frame.write(payload.length >> 8);
            frame.write(payload.length & 0xff);
        }
        byte[] mask = {1, 2, 3, 4};
        frame.write(mask);
        for (int index = 0; index < payload.length; index++) {
            frame.write(payload[index] ^ mask[index % 4]);
        }
        socket.getOutputStream().write(frame.toByteArray());
    }

    private static Frame read(InputStream input) throws Exception {
        int first = required(input);
        assertThat(first & 0x70).as("비압축 프레임의 RSV 비트").isZero();
        assertThat(first & 0x80).as("작은 STOMP 응답은 한 프레임이다").isNotZero();
        int length = required(input);
        assertThat(length & 0x80).as("서버 프레임은 마스킹하지 않는다").isZero();
        if (length == 126) {
            length = required(input) << 8 | required(input);
        }
        assertThat(length).isLessThan(16_384);
        byte[] payload = input.readNBytes(length);
        assertThat(payload).hasSize(length);
        return new Frame(first & 15, payload);
    }

    private static int required(InputStream input) throws Exception {
        int value = input.read();
        if (value < 0) {
            throw new EOFException("WebSocket 응답이 끝나기 전에 연결 종료");
        }
        return value;
    }

    private String bearer() {
        return "Bearer " + Jwts.builder().subject(UUID.randomUUID().toString()).claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8))).compact();
    }

    private record Frame(int opcode, byte[] payload) {
        String text() {
            assertThat(opcode).isIn(1, 2);
            return new String(payload, StandardCharsets.UTF_8);
        }
    }
}
