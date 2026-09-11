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
                try {
                    int edge = EDGE;
                    while (true) {
                        byte[] encoded = encode(decoded, edge);
                        if (encoded.length <= MAX_THUMBNAIL) {
                            return Base64.getEncoder().encodeToString(encoded);
                        }
                        if (edge == 1) {
                            throw new PreviewException("THUMBNAIL_TOO_LARGE");
                        }
                        // 노이즈가 많은 정상 이미지도 PNG 바이트 한도에 맞을 때까지 치수를 줄인다.
                        edge = Math.max(1, edge * 3 / 4);
                    }
                } finally {
                    decoded.flush();
                }
            } finally {
                reader.dispose();
            }
        }
    }

    private byte[] encode(BufferedImage source, int edge) throws IOException {
        double scale = Math.min(1, (double) edge / Math.max(source.getWidth(), source.getHeight()));
        BufferedImage output = new BufferedImage(Math.max(1, (int) (source.getWidth() * scale)),
                Math.max(1, (int) (source.getHeight() * scale)), BufferedImage.TYPE_INT_RGB);
        try {
            Graphics2D graphics = output.createGraphics();
            try {
                graphics.setColor(java.awt.Color.WHITE);
                graphics.fillRect(0, 0, output.getWidth(), output.getHeight());
                graphics.drawImage(source, 0, 0, output.getWidth(), output.getHeight(), null);
            } finally {
                graphics.dispose();
            }
            ByteArrayOutputStream encoded = new ByteArrayOutputStream();
            ImageIO.write(output, "png", encoded);
            return encoded.toByteArray();
        } finally {
            output.flush();
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
            if (process.exitValue() != 0 || !Files.exists(output) || Files.size(output) > 2 * 1024 * 1024) {
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
