package com.oneorthree.business;

import com.oneorthree.business.linkpreview.client.PublicAddressPolicy;
import com.oneorthree.business.linkpreview.exception.PreviewException;
import com.oneorthree.business.linkpreview.support.DriveLink;
import java.net.InetAddress;
import java.net.URI;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.*;

class LinkPolicyTest {
    @ParameterizedTest
    @ValueSource(strings = {"127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0",
            "100.100.100.200", "224.0.0.1", "198.18.0.1", "192.0.0.1", "203.0.113.1", "::1", "::",
            "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2002:7f00:1::1", "64:ff9b::7f00:1", "2001:db8::1", "192.0.2.0", "192.0.2.255", "198.51.100.0", "198.51.100.255",
            "192.0.0.8", "192.0.0.11", "192.88.99.2", "3fff::", "3fff::1", "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff"})
    void blocksNonPublicAddresses(String address) throws Exception {
        assertThat(PublicAddressPolicy.isPublic(InetAddress.getByName(address))).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "192.0.43.8", "192.2.0.1", "198.51.99.255",
            "198.51.101.0", "192.0.1.255", "192.0.3.0", "192.0.0.9", "192.0.0.10", "3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "3fff:1000::"})
    void allowsPublicAddresses(String address) throws Exception {
        assertThat(PublicAddressPolicy.isPublic(InetAddress.getByName(address))).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"file:///etc/passwd", "ftp://example.com/a", "https://user:pass@example.com/a",
            "http://localhost/a", "http://metadata.google.internal/a", "https://example.com:8443/a",
            "http://example.com./a", "HTTPS://example.com:80/a", "HTTP://example.com:443/a", "//example.com", "https://example.com\\@localhost"})
    void rejectsUnsafeUrls(String url) {
        assertThatThrownBy(() -> PublicAddressPolicy.parse(url)).isInstanceOf(PreviewException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"HTTPS://example.com:443/a%2Fb?key=a%2Bb", "HtTpS://example.com:443/a%2Fb?key=a%2Bb"})
    void normalizesSchemeWithoutChangingEscapedPathAndQuery(String url) {
        assertThat(PublicAddressPolicy.parse(url).toString()).isEqualTo("https://example.com:443/a%2Fb?key=a%2Bb");
    }

    @ParameterizedTest
    @ValueSource(strings = {"https://drive.google.com/file/d/abc_123/view?resourcekey=0-key",
            "https://drive.google.com/open?id=abc_123&resourcekey=0-key",
            "https://docs.google.com/document/d/abc_123/edit?resourcekey=0-key",
            "https://docs.google.com/spreadsheets/d/abc_123/edit?resourcekey=0-key#gid=0",
            "https://docs.google.com/presentation/d/abc_123/edit?resourcekey=0-key",
            "https://docs.google.com/document/u/0/d/abc_123/edit?resourcekey=0-key",
            "https://docs.google.com/spreadsheets/u/1/d/abc_123/edit?resourcekey=0-key",
            "https://docs.google.com/presentation/u/12/d/abc_123/edit?resourcekey=0-key"})
    void preservesDriveFileAndResourceKey(String url) {
        assertThat(DriveLink.from(PublicAddressPolicy.parse(url))).contains(new DriveLink("abc_123", "0-key"));
    }

    @Test
    void driveLookalikesDoNotGetApiCredentialsAndFoldersAreUnsupported() {
        assertThat(DriveLink.from(URI.create("https://drive.google.com.evil.com/file/d/a/view"))).isEmpty();
        assertThatThrownBy(() -> DriveLink.from(URI.create("https://drive.google.com/drive/folders/a")))
                .isInstanceOf(PreviewException.class);
        assertThatThrownBy(() -> DriveLink.from(URI.create("https://drive.google.com/open?id=a&resourcekey=%0d%0a")))
                .isInstanceOf(PreviewException.class);
    }
}
