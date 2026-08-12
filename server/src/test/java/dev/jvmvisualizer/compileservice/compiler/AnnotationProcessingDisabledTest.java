package dev.jvmvisualizer.compileservice.compiler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.arguments;

import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

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

    static Stream<Arguments> processorPathRuns() {
        return Stream.of(
                arguments("without the service options", List.of("--release", "21"), "true"),
                arguments("with the service options", InMemoryCompiler.options(), null));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("processorPathRuns")
    void runsAProcessorOnTheProcessorPathOnlyWhenTheServiceOptionsAreAbsent(String name, List<String> options,
                                                                           String expectedMarker) throws Exception {
        boolean succeeded = compileWithProcessorPath(options);

        assertThat(succeeded).isTrue();
        assertThat(System.getProperty(MarkerProcessor.MARKER_PROPERTY)).isEqualTo(expectedMarker);
    }

    @Test
    void serviceCompilerRunsNoAnnotationProcessor() {
        CompilationResult result = new InMemoryCompiler().compile(new SourceUnit("Annotated", ANNOTATED_SOURCE));

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
