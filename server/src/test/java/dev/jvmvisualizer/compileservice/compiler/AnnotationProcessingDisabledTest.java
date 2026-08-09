package dev.jvmvisualizer.compileservice.compiler;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.StandardLocation;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AnnotationProcessingDisabledTest {

    private static final String ANNOTATED_SOURCE = """
            public class Annotated {
                @Deprecated
                static int legacy() {
                    return 1;
                }
            }
            """;

    @TempDir
    Path classOutput;

    @BeforeEach
    @AfterEach
    void clearMarker() {
        System.clearProperty(MarkerProcessor.MARKER_PROPERTY);
    }

    @Test
    void controlRunShowsTheMarkerProcessorDoesExecuteWhenJavacIsAllowedTo() throws Exception {
        boolean succeeded = compileWithProcessorPath(List.of("--release", "21"));

        assertThat(succeeded).isTrue();
        assertThat(System.getProperty(MarkerProcessor.MARKER_PROPERTY)).isEqualTo("true");
    }

    @Test
    void serviceCompilerRunsNoAnnotationProcessor() {
        assertThat(InMemoryCompiler.options()).contains("-proc:none");

        CompilationResult result = new InMemoryCompiler().compile(ANNOTATED_SOURCE);

        assertThat(result).isInstanceOf(CompilationResult.Success.class);
        assertThat(System.getProperty(MarkerProcessor.MARKER_PROPERTY)).isNull();
    }

    private boolean compileWithProcessorPath(List<String> options) throws IOException, URISyntaxException {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        DiagnosticCollector<JavaFileObject> collector = new DiagnosticCollector<>();
        try (StandardJavaFileManager fileManager =
                     compiler.getStandardFileManager(collector, null, StandardCharsets.UTF_8)) {

            Path testClasses = Path.of(MarkerProcessor.class.getProtectionDomain()
                    .getCodeSource().getLocation().toURI());
            fileManager.setLocationFromPaths(StandardLocation.ANNOTATION_PROCESSOR_PATH,
                    List.of(testClasses.resolve("processor-path"), testClasses));
            fileManager.setLocationFromPaths(StandardLocation.CLASS_OUTPUT, List.of(classOutput));

            return compiler.getTask(null, fileManager, collector, options, null,
                    List.of(new StringSource("Annotated", ANNOTATED_SOURCE))).call();
        }
    }
}
