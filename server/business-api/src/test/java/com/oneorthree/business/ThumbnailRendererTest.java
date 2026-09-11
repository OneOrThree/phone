package com.oneorthree.business;

import com.oneorthree.business.linkpreview.support.ThumbnailRenderer;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.*;

class ThumbnailRendererTest {
    final ThumbnailRenderer renderer = new ThumbnailRenderer();

    @Test
    void scalesImageTo480PixelsAndRejectsInvalidInput() throws Exception {
        var source = new BufferedImage(1200, 600, BufferedImage.TYPE_INT_RGB);
        var bytes = new ByteArrayOutputStream();
        ImageIO.write(source, "png", bytes);
        var decoded = ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(renderer.image(bytes.toByteArray()))));
        assertThat(decoded.getWidth()).isEqualTo(480);
        assertThat(decoded.getHeight()).isEqualTo(240);
        assertThatThrownBy(() -> renderer.image(new byte[]{1, 2, 3})).hasMessage("INVALID_IMAGE");
    }

    @Test
    void rendersRealPdfFirstPageInSeparateProcess() throws Exception {
        byte[] pdf = ("%PDF-1.4\n"
                + "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
                + "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
                + "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >> endobj\n"
                + "trailer << /Root 1 0 R >>\n%%EOF\n").getBytes(StandardCharsets.US_ASCII);
        var image = ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(renderer.pdf(pdf))));
        assertThat(image.getWidth()).isEqualTo(480);
        assertThat(image.getHeight()).isBetween(240, 241);
        assertThatThrownBy(() -> renderer.pdf(new byte[]{1})).hasMessage("INVALID_PDF");
    }
}
