package dev.jvmvisualizer.compileservice.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = "compile.rate-limit.requests-per-minute=1000")
class ChunkedRequestSizeLimitTest {

    private static final int PADDING_FIELDS = 8;
    private static final int PADDING_CHARACTERS = 50 * 1024;

    @LocalServerPort
    private int port;

    @Test
    void refusesAChunkedBodyThatOutgrowsTheLimitWhileItIsBeingRead() throws Exception {
        HttpResponse<String> response = postChunked(oversizedBody());

        assertThat(response.statusCode()).isEqualTo(HttpStatus.BAD_REQUEST.value());
        assertThat(response.body())
                .contains("source-too-large")
                .contains("the request body is at least");
    }

    @Test
    void compilesAChunkedBodyThatStaysUnderTheLimit() throws Exception {
        HttpResponse<String> response = postChunked("{\"source\":\"public class Adder { }\"}");

        assertThat(response.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(response.body()).contains("\"className\":\"Adder\"");
    }

    private static String oversizedBody() {
        StringBuilder body = new StringBuilder("{\"source\":\"public class Adder { }\"");
        for (int field = 0; field < PADDING_FIELDS; field++) {
            body.append(",\"padding").append(field).append("\":\"").append("x".repeat(PADDING_CHARACTERS)).append('"');
        }
        return body.append('}').toString();
    }

    private HttpResponse<String> postChunked(String body) throws Exception {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/compile"))
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .POST(HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(bytes)))
                .build();

        try (HttpClient client = HttpClient.newHttpClient()) {
            return client.send(request, HttpResponse.BodyHandlers.ofString());
        }
    }
}
