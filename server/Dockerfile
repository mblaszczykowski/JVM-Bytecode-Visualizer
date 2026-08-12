# syntax=docker/dockerfile:1

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY pom.xml .
RUN mvn -B -ntp dependency:go-offline
COPY src ./src
RUN mvn -B -ntp -DskipTests package

# Unpacked, because a compilation runs in a child JVM launched with this process's
# java.class.path. Under "-jar app.jar" that property is the jar alone and the application classes
# sit inside BOOT-INF, where a plain "java -cp" cannot find them. The exploded layout gives both
# processes a usable class path.
RUN mkdir -p /workspace/app \
    && cd /workspace/app \
    && jar --extract --file /workspace/target/compile-service-*.jar


# The runtime image must be a JDK: the service compiles Java on demand, and without the
# jdk.compiler module ToolProvider.getSystemJavaCompiler() returns null and every request fails.
FROM eclipse-temurin:21-jdk-jammy AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app

WORKDIR /app
COPY --from=build --chown=app:app /workspace/app/BOOT-INF/lib /app/lib
COPY --from=build --chown=app:app /workspace/app/BOOT-INF/classes /app/classes
USER app

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/actuator/health" | grep -q '"status":"UP"' || exit 1

# A quarter of the container, because most of it belongs to the compiler processes. Each child is
# capped at 240 MB (128 MB heap, 64 MB metaspace, 32 MB code cache, 16 MB direct buffers) plus
# roughly 25 MB of JVM bookkeeping, and compile.max-concurrent-compilations of them run at a time.
# This service holds no state and its own working set is small; the sizing is in docs/deployment.md.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=25", "-cp", "/app/classes:/app/lib/*", \
            "dev.jvmvisualizer.compileservice.CompileServiceApplication"]
