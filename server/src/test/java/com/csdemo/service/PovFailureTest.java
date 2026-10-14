package com.csdemo.service;

import com.csdemo.repository.DatabaseRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PovFailureTest {
  @TempDir Path output;
  @Test void structuredDiagnosisWinsOverGenericExitCode() throws Exception {
    Files.writeString(output.resolve("worker-error.json"),"{\"message\":\"缺少 FFprobe，请进入设置页补全\"}");
    assertEquals("缺少 FFprobe，请进入设置页补全",new DemoService(mock(DatabaseRepository.class)).povFailure(output,1));
  }
  @Test void startupFailurePreservesLogWithoutInventingMissingComponents() throws Exception {
    Files.writeString(output.resolve("render.log"),"Access denied launching Python");
    String message=new DemoService(mock(DatabaseRepository.class)).povFailure(output,1);
    assertTrue(message.contains("Access denied"));assertFalse(message.contains("缺少 FFprobe"));
  }
}
