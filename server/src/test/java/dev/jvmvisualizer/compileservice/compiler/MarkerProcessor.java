package dev.jvmvisualizer.compileservice.compiler;

import java.util.Set;
import javax.annotation.processing.AbstractProcessor;
import javax.annotation.processing.RoundEnvironment;
import javax.annotation.processing.SupportedAnnotationTypes;
import javax.annotation.processing.SupportedSourceVersion;
import javax.lang.model.SourceVersion;
import javax.lang.model.element.TypeElement;

/**
 * Records the fact that it ran in a system property. javac loads processors in its own class
 * loader, so a static field would not necessarily be the one the test can read; a system property
 * is JVM-wide.
 */
@SupportedAnnotationTypes("java.lang.Deprecated")
@SupportedSourceVersion(SourceVersion.RELEASE_21)
public class MarkerProcessor extends AbstractProcessor {

    public static final String MARKER_PROPERTY = "compile-service.test.processor-executed";

    @Override
    public boolean process(Set<? extends TypeElement> annotations, RoundEnvironment roundEnv) {
        if (!annotations.isEmpty()) {
            System.setProperty(MARKER_PROPERTY, "true");
        }
        return false;
    }
}
