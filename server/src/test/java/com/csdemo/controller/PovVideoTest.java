package com.csdemo.controller;

import com.csdemo.service.DemoService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.nio.file.*;
import java.util.Arrays;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PovVideoTest {
  @TempDir Path directory;
  @Test void fullVideoAndByteRangesAreNotTruncatedToOneMegabyte() throws Exception {
    byte[] bytes=new byte[2*1024*1024+123];
    for(int i=0;i<bytes.length;i++)bytes[i]=(byte)(i%251);
    Path file=directory.resolve("final.mp4");Files.write(file,bytes);
    DemoService service=mock(DemoService.class);
    when(service.povFilePath("job")).thenReturn(file);
    when(service.povPlayerFilePath("job","0")).thenReturn(file);
    MockMvc mvc=MockMvcBuilders.standaloneSetup(new DemoController(service)).build();
    String url="/api/pov/export/job/player/0";
    byte[] full=mvc.perform(get(url)).andExpect(status().isOk())
      .andExpect(header().string("Content-Length",String.valueOf(bytes.length)))
      .andReturn().getResponse().getContentAsByteArray();
    assertArrayEquals(bytes,full);
    byte[] range=mvc.perform(get(url).header("Range","bytes=0-2097151"))
      .andExpect(status().isPartialContent()).andExpect(header().string("Content-Range","bytes 0-2097151/"+bytes.length))
      .andReturn().getResponse().getContentAsByteArray();
    assertArrayEquals(Arrays.copyOfRange(bytes,0,2097152),range);
    byte[] suffix=mvc.perform(get("/api/pov/export/job/file").header("Range","bytes=-123"))
      .andExpect(status().isPartialContent()).andReturn().getResponse().getContentAsByteArray();
    assertArrayEquals(Arrays.copyOfRange(bytes,bytes.length-123,bytes.length),suffix);
    mvc.perform(get(url).header("Range","bytes=9999999-")).andExpect(status().isRequestedRangeNotSatisfiable());
    mvc.perform(head(url)).andExpect(status().isOk()).andExpect(header().string("Content-Length",String.valueOf(bytes.length)));
  }
}
