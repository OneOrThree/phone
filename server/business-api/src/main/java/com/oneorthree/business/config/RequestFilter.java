package com.oneorthree.business.config;

import com.oneorthree.business.auth.JwtValidator;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class RequestFilter extends OncePerRequestFilter {

    private static final Logger LOG = LoggerFactory.getLogger(RequestFilter.class);
    private static final int MAX_BODY = 48 * 1024;
    private final JwtValidator jwt;

    public RequestFilter(JwtValidator jwt) {
        this.jwt = jwt;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        String requestId = UUID.randomUUID().toString();
        long started = System.nanoTime();
        request.setAttribute("requestId", requestId);
        response.setHeader("X-Request-Id", requestId);
        response.setHeader("Cache-Control", "no-store");
        try {
            var user = jwt.validate(request.getHeader("Authorization"));
            if (user.isEmpty()) {
                error(response, 401, "UNAUTHORIZED");
                return;
            }
            if (request.getContentLengthLong() > MAX_BODY) {
                error(response, 413, "REQUEST_TOO_LARGE");
                return;
            }
            request.setAttribute("userId", user.get());
            ServletInputStream input = request.getInputStream();
            chain.doFilter(new HttpServletRequestWrapper(request) {
                private final ServletInputStream limited = new ServletInputStream() {
                    private int count;

                    @Override
                    public int read() throws IOException {
                        int value = input.read();
                        if (value != -1 && ++count > MAX_BODY) {
                            throw new IOException("REQUEST_TOO_LARGE");
                        }
                        return value;
                    }

                    @Override
                    public boolean isFinished() {
                        return input.isFinished();
                    }

                    @Override
                    public boolean isReady() {
                        return input.isReady();
                    }

                    @Override
                    public void setReadListener(ReadListener listener) {
                        input.setReadListener(listener);
                    }
                };

                @Override
                public ServletInputStream getInputStream() {
                    return limited;
                }
            }, response);
        } finally {
            LOG.info("business_request request_id={} method={} status={} duration_ms={}", requestId,
                    request.getMethod(), response.getStatus(),
                    TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
        }
    }

    private void error(HttpServletResponse response, int status, String code) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"code\":\"" + code + "\",\"message\":\"요청을 처리할 수 없습니다.\"}");
    }
}
