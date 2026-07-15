package dev.jvmvisualizer.compileservice;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class CompileServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(CompileServiceApplication.class, args);
    }
}
