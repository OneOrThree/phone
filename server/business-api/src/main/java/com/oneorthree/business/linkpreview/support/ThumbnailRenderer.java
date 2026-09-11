package com.oneorthree.business.linkpreview.support;

import com.oneorthree.business.linkpreview.exception.PreviewException;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.springframework.stereotype.Component;

@Component
public class ThumbnailRenderer {

    private static final int EDGE = 480;
    private static final int MAX_THUMBNAIL = 512 * 1024;

    public String image(byte[] bytes) throws IOException {
        try (var stream = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
            var readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) {
                throw new PreviewException("INVALID_IMAGE");
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(stream, true, true);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width <= 0 || height <= 0 || (long) width * height > 20_000_000) {
                    throw new PreviewException("IMAGE_TOO_LARGE");
                }
                var parameters = reader.getDefaultReadParam();
                int sample = Math.max(1, Math.max(width, height) / EDGE);
                parameters.setSourceSubsampling(sample, sample, 0, 0);
                BufferedImage decoded = reader.read(0, parameters);
                double scale = Math.min(1, (double) EDGE / Math.max(decoded.getWidth(), decoded.getHeight()));
                BufferedImage output = new BufferedImage(Math.max(1, (int) (decoded.getWidth() * scale)),
                        Math.max(1, (int) (decoded.getHeight() * scale)), BufferedImage.TYPE_INT_RGB);
                Graphics2D graphics = output.createGraphics();
                try {
                    graphics.setColor(java.awt.Color.WHITE);
                    graphics.fillRect(0, 0, output.getWidth(), output.getHeight());
                    graphics.drawImage(decoded, 0, 0, output.getWidth(), output.getHeight(), null);
                } finally {
                    graphics.dispose();
                    decoded.flush();
                }
                ByteArrayOutputStream encoded = new ByteArrayOutputStream();
                ImageIO.write(output, "png", encoded);
                output.flush();
                if (encoded.size() > MAX_THUMBNAIL) {
                    throw new PreviewException("THUMBNAIL_TOO_LARGE");
                }
                return Base64.getEncoder().encodeToString(encoded.toByteArray());
            } finally {
                reader.dispose();
            }
        }
    }

    public String pdf(byte[] bytes) throws IOException, InterruptedException {
        Path directory = Files.createTempDirectory("business-preview-");
        Path input = directory.resolve("input.pdf");
        Path output = directory.resolve("page.png");
        Process process = null;
        try {
            Files.write(input, bytes);
            List<String> command = new ArrayList<>();
            if (System.getProperty("os.name").startsWith("Linux")) {
                command.addAll(List.of("prlimit", "--as=268435456", "--cpu=6", "--fsize=2097152", "--"));
            }
            command.addAll(List.of("pdftoppm", "-f", "1", "-singlefile", "-scale-to", "480", "-png",
                    input.toString(), directory.resolve("page").toString()));
            process = new ProcessBuilder(command).redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            if (!process.waitFor(8, TimeUnit.SECONDS)) {
                throw new PreviewException("RENDER_TIMEOUT");
            }
            if (process.exitValue() != 0 || !Files.exists(output) || Files.size(output) > MAX_THUMBNAIL) {
                throw new PreviewException("INVALID_PDF");
            }
            return image(Files.readAllBytes(output));
        } finally {
            if (process != null && process.isAlive()) {
                process.destroyForcibly();
                process.waitFor(2, TimeUnit.SECONDS);
            }
            Files.deleteIfExists(output);
            Files.deleteIfExists(input);
            Files.deleteIfExists(directory);
        }
    }
}
