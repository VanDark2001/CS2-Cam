package com.csdemo.controller;

import com.csdemo.service.DemoService;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** HTTP 适配层：只负责参数绑定、路由和统一错误响应。 */
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "http://localhost:5173")
public class DemoController {
  private final DemoService demoService;

  public DemoController(DemoService demoService) { this.demoService=demoService; }

  @GetMapping("/matches") public List<Map<String,Object>> matches() throws SQLException { return demoService.matches(); }
  @GetMapping("/matches/{id}") public Map<String,Object> detail(@PathVariable long id) throws SQLException { return demoService.detail(id); }
  @DeleteMapping("/matches/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) public void deleteMatch(@PathVariable long id) throws SQLException, IOException { demoService.deleteMatch(id); }
  @GetMapping("/matches/{id}/replay") public Map<String,Object> replay(@PathVariable long id,@RequestParam int round,@RequestParam(defaultValue="0") long tick) throws SQLException { return demoService.replay(id,round,tick); }
  @PostMapping("/pov/export") public Map<String,Object> povExport(@RequestBody Map<String,Object> task) throws Exception { return demoService.startPovExport(task); }
  @GetMapping("/pov/export/{jobId}") public Map<String,Object> povJob(@PathVariable String jobId) { return demoService.povJob(jobId); }
  @GetMapping("/pov/exports") public List<Map<String,Object>> povExports(@RequestParam long matchId) throws IOException { return demoService.povExports(matchId); }
  @DeleteMapping("/pov/export/{jobId}") @ResponseStatus(HttpStatus.NO_CONTENT) public void deletePovExport(@PathVariable String jobId) throws IOException { demoService.deletePovExport(jobId); }
  private ResponseEntity<Resource> video(PathLike pathLike) throws IOException {
    Resource resource=new FileSystemResource(pathLike.path());
    if(resource.contentLength()==0)throw new IOException("视频文件为空");
    // Spring streams complete GETs and converts Range requests to ResourceRegions.
    // Never truncate an un-ranged fetch or allocate the whole video on the server.
    return ResponseEntity.ok().header(HttpHeaders.ACCEPT_RANGES,"bytes")
      .contentType(MediaType.valueOf("video/mp4")).contentLength(resource.contentLength()).body(resource);
  }
  @FunctionalInterface private interface PathLike { java.nio.file.Path path() throws IOException; }
  @GetMapping(value="/pov/export/{jobId}/file",produces="video/mp4") public ResponseEntity<Resource> povFile(@PathVariable String jobId) throws IOException { return video(()->demoService.povFilePath(jobId)); }
  @GetMapping(value="/pov/export/{jobId}/player/{player}",produces="video/mp4") public ResponseEntity<Resource> povPlayerFile(@PathVariable String jobId,@PathVariable String player) throws IOException { return video(()->demoService.povPlayerFilePath(jobId,player)); }
  @GetMapping("/matches/{id}/analytics") public Map<String,Object> analytics(@PathVariable long id) throws SQLException { return demoService.analytics(id); }
  @GetMapping("/players/{steamid}/weapons") public List<Map<String,Object>> playerWeapons(@PathVariable String steamid) throws SQLException { return demoService.playerWeapons(steamid); }
  @GetMapping("/players/{steamid}/stats") public Map<String,Object> playerStats(@PathVariable String steamid) throws SQLException { return demoService.playerStats(steamid); }
  @GetMapping(value="/avatars/{steamid}",produces=MediaType.IMAGE_JPEG_VALUE) public byte[] avatar(@PathVariable String steamid) throws IOException { return demoService.avatar(steamid); }
  @GetMapping("/health/db") public Map<String,Object> health() { return demoService.health(); }
  @DeleteMapping("/database") public Map<String,Object> clearDatabase() throws SQLException, IOException { return demoService.clearDatabase(); }
  @PostMapping(value="/demos",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
  public Map<String,Object> upload(@RequestPart("file") MultipartFile file,@RequestParam(value="recordedAt",required=false) Long recordedAt) throws IOException,InterruptedException,SQLException { return demoService.upload(file,recordedAt); }

  @ExceptionHandler({IllegalStateException.class,SQLException.class,IOException.class})
  @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
  public Map<String,Object> error(Exception exception) {
    String message=Optional.ofNullable(exception.getMessage()).filter(value->!value.isBlank()).orElse(exception.getClass().getSimpleName());
    return Map.of("status","error","message",message);
  }
}
