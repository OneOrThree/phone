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
            "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2002:7f00:1::1", "64:ff9b::7f00:1", "2001:db8::1"})
    void blocksNonPublicAddresses(String address) throws Exception {
        assertThat(PublicAddressPolicy.isPublic(InetAddress.getByName(address))).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"})
    void allowsPublicAddresses(String address) throws Exception {
        assertThat(PublicAddressPolicy.isPublic(InetAddress.getByName(address))).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"file:///etc/passwd", "ftp://example.com/a", "https://user:pass@example.com/a",
            "http://localhost/a", "http://metadata.google.internal/a", "https://example.com:8443/a",
            "http://example.com./a", "//example.com", "https://example.com\\@localhost"})
    void rejectsUnsafeUrls(String url) {
        assertThatThrownBy(() -> PublicAddressPolicy.parse(url)).isInstanceOf(PreviewException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"https://drive.google.com/file/d/abc_123/view?resourcekey=0-key",
            "https://drive.google.com/open?id=abc_123&resourcekey=0-key",
            "https://docs.google.com/document/d/abc_123/edit?resourcekey=0-key",
            "https://docs.google.com/spreadsheets/d/abc_123/edit?resourcekey=0-key#gid=0",
            "https://docs.google.com/presentation/d/abc_123/edit?resourcekey=0-key"})
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
