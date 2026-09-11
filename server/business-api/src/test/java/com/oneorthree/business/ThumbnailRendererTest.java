package com.oneorthree.business;

import com.oneorthree.business.linkpreview.support.ThumbnailRenderer;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.util.Random;

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

    @ParameterizedTest
    @ValueSource(strings = {"png", "jpeg"})
    void keepsNoisyImageThumbnailWithinByteAndDimensionLimits(String format) throws Exception {
        var source = new BufferedImage(480, 480, BufferedImage.TYPE_INT_RGB);
        var random = new Random(1747);
        for (int y = 0; y < source.getHeight(); y++) {
            for (int x = 0; x < source.getWidth(); x++) source.setRGB(x, y, random.nextInt(0x1000000));
        }
        var input = new ByteArrayOutputStream();
        ImageIO.write(source, format, input);
        if ("png".equals(format)) assertThat(input.size()).isGreaterThan(512 * 1024);
        byte[] result = Base64.getDecoder().decode(renderer.image(input.toByteArray()));
        assertThat(result.length).isLessThanOrEqualTo(512 * 1024);
        var thumbnail = ImageIO.read(new ByteArrayInputStream(result));
        assertThat(thumbnail.getWidth()).isBetween(1, 480);
        assertThat(thumbnail.getHeight()).isEqualTo(thumbnail.getWidth());
    }

    @Test
    void downsizesNoisyPdfOutputBeforeApplyingThumbnailLimit() throws Exception {
        byte[] pixels = new byte[480 * 480 * 3];
        new Random(1747).nextBytes(pixels);
        var pdf = new ByteArrayOutputStream();
        pdf.write(("%PDF-1.4\n"
                + "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
                + "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
                + "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 480 480] "
                + "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >> endobj\n"
                + "4 0 obj << /Type /XObject /Subtype /Image /Width 480 /Height 480 "
                + "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length " + pixels.length + " >> stream\n")
                .getBytes(StandardCharsets.US_ASCII));
        pdf.write(pixels);
        String drawing = "q 480 0 0 480 0 0 cm /Im0 Do Q\n";
        pdf.write(("\nendstream endobj\n5 0 obj << /Length " + drawing.length() + " >> stream\n"
                + drawing + "endstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n")
                .getBytes(StandardCharsets.US_ASCII));
        byte[] result = Base64.getDecoder().decode(renderer.pdf(pdf.toByteArray()));
        assertThat(result.length).isLessThanOrEqualTo(512 * 1024);
        var thumbnail = ImageIO.read(new ByteArrayInputStream(result));
        assertThat(thumbnail.getWidth()).isBetween(1, 479);
        assertThat(thumbnail.getHeight()).isEqualTo(thumbnail.getWidth());
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
