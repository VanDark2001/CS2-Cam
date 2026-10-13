package com.csdemo.controller;

import com.csdemo.service.MatchPackageService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.*;

@RestController
@RequestMapping("/api")
public class MatchPackageController {
  private final MatchPackageService service;
  public MatchPackageController(MatchPackageService service) { this.service=service; }
  public record ExportRequest(List<Map<String,Object>> favorites,String scope) {}
  @PostMapping("/matches/{id}/package")
  public Map<String,Object> exportMatch(@PathVariable long id,@RequestBody(required=false) ExportRequest request) throws Exception {
    return service.exportMatch(id,request==null||request.favorites()==null?List.of():request.favorites(),request==null||request.scope()==null?"match":request.scope());
  }
  @GetMapping("/match-packages/jobs/{id}") public Map<String,Object> status(@PathVariable String id) { return service.status(id); }
  @GetMapping("/match-packages/jobs/{id}/file")
  public ResponseEntity<FileSystemResource> file(@PathVariable String id) {
    return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename(String.valueOf(service.status(id).get("fileName"))).build().toString()).body(new FileSystemResource(service.download(id)));
  }
  @PostMapping(value="/match-packages/import",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
  public Map<String,Object> importMatch(@RequestPart("file") MultipartFile file) throws Exception { return service.importMatch(file); }
  @ExceptionHandler(Exception.class)
  public ResponseEntity<Map<String,Object>> error(Exception e) {
    HttpStatusCode status=e instanceof org.springframework.web.server.ResponseStatusException response?response.getStatusCode():HttpStatus.INTERNAL_SERVER_ERROR;
    return ResponseEntity.status(status).body(Map.of("status","error","message",Optional.ofNullable(e.getMessage()).orElse("比赛包处理失败")));
  }
}
