package com.csdemo.service;

import com.csdemo.repository.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import java.util.zip.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MatchPackageServiceTest {
  @TempDir Path directory;
  private DatabaseRepository db;
  private MatchPackageService service;
  private DemoService demos;
  private String previousDir;
  @BeforeEach void setup() throws Exception {
    previousDir=System.getProperty("user.dir");System.setProperty("user.dir",directory.resolve("server").toString());
    Files.createDirectories(directory.resolve("server"));
    db=new DatabaseRepository("jdbc:sqlite:"+directory.resolve("测试 数据.sqlite3"));
    db.initialize();
    try(Connection c=db.connection();Statement s=c.createStatement()) {
      s.execute("INSERT INTO matches(id,demo_file_path,map_name) VALUES(1,'C:/private/source.dem','de_inferno')");
      s.execute("INSERT INTO players VALUES('90000000000000004','TestPlayer')");
      s.execute("INSERT INTO match_players(match_id,steamid,team_number) VALUES(1,'90000000000000004',3)");
      s.execute("INSERT INTO rounds(id,match_id,tick,round_number) VALUES(10,1,1178,1)");
      s.execute("INSERT INTO events(match_id,round_id,tick) VALUES(1,10,1180)");
      s.execute("INSERT INTO player_positions(match_id,tick,steamid,x,y,health,team_number) VALUES(1,1180,'90000000000000004',123.5,NULL,NULL,3)");
    }
    demos=mock(DemoService.class);
    when(demos.detail(1)).thenReturn(Map.of("id",1,"map","de_inferno","date","2026-10-08 15:26:29","dateSource","file_last_modified","file","missing.dem"));
    Path pov=directory.resolve("server/pov-output/1/round-1-test");Files.createDirectories(pov.resolve("players/player_0"));
    Files.write(pov.resolve("final.mp4"),new byte[]{1,2,3,4});Files.write(pov.resolve("players/player_0/final.mp4"),new byte[]{1,2,3,4});
    when(demos.povExports(1)).thenReturn(List.of(Map.of("output",pov.toString(),"round",1,"players",List.of(Map.of("steamid","90000000000000004","name","TestPlayer","slot",0)))));
    service=new MatchPackageService(new MatchPackageRepository(db),demos);
  }
  @AfterEach void teardown() { service.close();System.setProperty("user.dir",previousDir); }
  private Map<String,Object> await(Map<String,Object> started) throws Exception {
    for(int i=0;i<500;i++) { Map<String,Object> job=service.status((String)started.get("jobId"));if(Set.of("completed","failed").contains(job.get("status")))return job;Thread.sleep(20); }throw new AssertionError("task did not finish");
  }
  private byte[] packageBytes() throws Exception {
    Map<String,Object> favorite=Map.of("matchId",1,"round",1,"title","B 点战术","note","rush b","players",List.of(Map.of("steamid","90000000000000004","name","TestPlayer")));
    Map<String,Object> result=await(service.exportMatch(1,List.of(favorite)));assertEquals("completed",result.get("status"),result.toString());
    Path file=service.download((String)result.get("jobId"));
    try(ZipFile zip=new ZipFile(file.toFile())) {
      String data=new String(zip.getInputStream(zip.getEntry("data.ndjson")).readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
      assertFalse(data.contains("C:/private"));assertNotNull(zip.getEntry("pov/0/players/player_0/final.mp4"));
    }
    return Files.readAllBytes(file);
  }
  private Map<String,Object> restore(byte[] bytes) throws Exception { return await(service.importMatch(new MockMultipartFile("file","match.csdemo","application/octet-stream",bytes))); }

  @Test void roundTripRemapsIdsPreservesNullsPovsAndNotesAndRepeatImportIsIdempotent() throws Exception {
    byte[] bytes=packageBytes();Map<String,Object> result=restore(bytes);assertEquals("completed",result.get("status"),result.toString());long id=((Number)result.get("matchId")).longValue();assertNotEquals(1,id);
    try(Connection c=db.connection();Statement s=c.createStatement()) {
      try(ResultSet r=s.executeQuery("SELECT e.round_id,r.id,r.match_id FROM events e JOIN rounds r ON r.id=e.round_id WHERE e.match_id="+id)) { assertTrue(r.next());assertEquals(r.getLong(1),r.getLong(2));assertEquals(id,r.getLong(3));assertNotEquals(10,r.getLong(1)); }
      try(ResultSet r=s.executeQuery("SELECT x,y,health,team_number FROM player_positions WHERE match_id="+id)) { assertTrue(r.next());assertEquals(123.5,r.getDouble(1));assertNull(r.getObject(2));assertNull(r.getObject(3));assertEquals(3,r.getInt(4)); }
    }
    List<?> favorites=(List<?>)result.get("favorites");assertEquals("rush b",((Map<?,?>)favorites.get(0)).get("note"));assertEquals("B 点战术",((Map<?,?>)favorites.get(0)).get("title"));assertEquals(id,((Map<?,?>)favorites.get(0)).get("matchId"));
    Path povRoot=directory.resolve("server/pov-output/"+id);Path imported;try(var dirs=Files.list(povRoot)) { imported=dirs.findFirst().orElseThrow(); }
    assertArrayEquals(new byte[]{1,2,3,4},Files.readAllBytes(imported.resolve("players/player_0/final.mp4")));assertTrue(Files.exists(imported.resolve("hlae-worker.json")));
    Map<String,Object> repeated=restore(bytes);assertEquals("completed",repeated.get("status"),repeated.toString());assertEquals(id,repeated.get("matchId"));assertEquals(true,repeated.get("duplicate"));
    try(var dirs=Files.list(povRoot)) { assertEquals(1,dirs.count()); }
    try(Connection c=db.connection();Statement s=c.createStatement();ResultSet r=s.executeQuery("SELECT COUNT(*) FROM matches")) { r.next();assertEquals(2,r.getInt(1)); }
  }
  @Test void pathTraversalAndUnknownEntriesAreRejectedWithoutDatabaseChanges() throws Exception {
    assertFalse(MatchPackageService.safeEntry("../outside.mp4"));assertFalse(MatchPackageService.safeEntry("pov/0/../../outside.mp4"));assertFalse(MatchPackageService.safeEntry("C:/evil.sql"));assertFalse(MatchPackageService.safeEntry("data.sql"));assertTrue(MatchPackageService.safeEntry("pov/0/players/player_10/final.mp4"));
    java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
    try(ZipOutputStream zip=new ZipOutputStream(bytes)) { zip.putNextEntry(new ZipEntry("../outside.mp4"));zip.write(7);zip.closeEntry(); }
    Map<String,Object> result=restore(bytes.toByteArray());assertEquals("failed",result.get("status"));assertFalse(Files.exists(directory.resolve("outside.mp4")));
    try(Connection c=db.connection();Statement s=c.createStatement();ResultSet r=s.executeQuery("SELECT COUNT(*) FROM matches")) { r.next();assertEquals(1,r.getInt(1)); }
  }
  @Test void damagedArchiveIsRejected() throws Exception {
    byte[] bytes=packageBytes();assertEquals("failed",restore(Arrays.copyOf(bytes,bytes.length/2)).get("status"));
  }
  @Test void databaseImportRollbackAndColumnWhitelist() throws Exception {
    try(MatchPackageRepository.ImportSession session=new MatchPackageRepository(db).beginImport()) {
      session.insert("matches",Map.of("id",1,"map_name","de_inferno"),1,0,"rollback.dem");
      assertThrows(java.io.IOException.class,()->session.insert("players",Map.of("steamid","90000000000000004","name","X","password","bad"),1,1,"rollback.dem"));
    }
    try(Connection c=db.connection();Statement s=c.createStatement();ResultSet r=s.executeQuery("SELECT COUNT(*) FROM matches")) { r.next();assertEquals(1,r.getInt(1)); }
    assertThrows(java.io.IOException.class,()->MatchPackageService.number(1.5));
  }
  @Test void importingAnExportOfExistingMatchDoesNotDuplicateItsOriginalPov() throws Exception {
    try(Connection c=db.connection();Statement s=c.createStatement()) { s.execute("UPDATE matches SET demo_sha256='"+"a".repeat(64)+"' WHERE id=1"); }
    Map<String,Object> result=restore(packageBytes());assertEquals("completed",result.get("status"),result.toString());assertEquals(1L,result.get("matchId"));assertEquals(true,result.get("duplicate"));
    try(var dirs=Files.list(directory.resolve("server/pov-output/1"))) { assertEquals(1,dirs.count()); }
  }
  @Test void mediaChecksumTamperingIsRejectedAndInvalidRoundReferenceRollsBackAllRows() throws Exception {
    byte[] archive=packageBytes();assertEquals("failed",restore(rewrite(archive,false)).get("status"));
    assertEquals("failed",restore(rewrite(archive,true)).get("status"));
    try(Connection c=db.connection();Statement s=c.createStatement();ResultSet r=s.executeQuery("SELECT COUNT(*) FROM matches")) { r.next();assertEquals(1,r.getInt(1)); }
  }
  @Test void favoriteScopeIncludesOnlySelectedRoundAndPlayerAndNeverIncludesDemo() throws Exception {
    Path source=directory.resolve("server/pov-output/1/round-1-test"),other=directory.resolve("server/pov-output/1/round-2-test");
    Files.createDirectories(source.resolve("players/player_1"));Files.write(source.resolve("players/player_1/final.mp4"),new byte[]{8,8});Files.createDirectories(other);Files.write(other.resolve("final.mp4"),new byte[]{9,9});
    Path demo=directory.resolve("original.dem");Files.write(demo,new byte[]{7,7});
    when(demos.detail(1)).thenReturn(Map.of("id",1,"map","de_inferno","date","2026-10-08 15:26:29","dateSource","file_last_modified","file",demo.toString()));
    List<Map<String,Object>> identities=List.of(Map.of("steamid","90000000000000004","name","A","slot",9),Map.of("steamid","90000000000000002","name","B","slot",7));
    when(demos.povExports(1)).thenReturn(List.of(Map.of("output",source.toString(),"round",1,"players",identities),Map.of("output",other.toString(),"round",2,"players",List.of(identities.get(0)))));
    Map<String,Object> favorite=Map.of("matchId",1,"round",1,"title","命名收藏","note","keep","players",List.of(identities.get(1)));
    Map<String,Object> scoped=await(service.exportMatch(1,List.of(favorite),"favorites"));assertEquals("completed",scoped.get("status"),scoped.toString());assertEquals(1,scoped.get("viewCount"));assertEquals(0,scoped.get("missingViews"));
    try(ZipFile zip=new ZipFile(service.download((String)scoped.get("jobId")).toFile())) {
      assertNull(zip.getEntry("demo/source.dem"));assertNull(zip.getEntry("pov/1/final.mp4"));assertNull(zip.getEntry("pov/0/players/player_1/final.mp4"));
      assertArrayEquals(new byte[]{8,8},zip.getInputStream(zip.getEntry("pov/0/final.mp4")).readAllBytes());assertArrayEquals(new byte[]{8,8},zip.getInputStream(zip.getEntry("pov/0/players/player_0/final.mp4")).readAllBytes());
      Map<?,?> manifest=new ObjectMapper().readValue(zip.getInputStream(zip.getEntry("manifest.json")),Map.class);
      assertEquals("favorites",manifest.get("scope"));assertEquals("命名收藏",((Map<?,?>)((List<?>)manifest.get("favorites")).get(0)).get("title"));
      assertEquals("90000000000000002",((Map<?,?>)((List<?>)((Map<?,?>)((List<?>)manifest.get("povs")).get(0)).get("players")).get(0)).get("steamid"));
    }
    Map<String,Object> full=await(service.exportMatch(1,List.of(favorite),"match"));assertEquals("completed",full.get("status"));assertEquals(3,full.get("viewCount"));
    try(ZipFile zip=new ZipFile(service.download((String)full.get("jobId")).toFile())) { assertNull(zip.getEntry("demo/source.dem"));assertNotNull(zip.getEntry("pov/0/players/player_1/final.mp4"));assertNotNull(zip.getEntry("pov/1/final.mp4")); }
    Map<String,Object> imported=restore(Files.readAllBytes(service.download((String)scoped.get("jobId"))));assertEquals("completed",imported.get("status"),imported.toString());assertEquals("命名收藏",((Map<?,?>)((List<?>)imported.get("favorites")).get(0)).get("title"));
  }
  @Test void favoriteScopeReportsMissingViewsAndDoesNotDuplicateTheSameIdentity() throws Exception {
    Map<String,Object> favorite=Map.of("matchId",1,"round",1,"players",List.of(Map.of("steamid","90000000000000004","name","A"),Map.of("steamid","90000000000000002","name","B")));
    Map<String,Object> pov=demos.povExports(1).get(0);when(demos.povExports(1)).thenReturn(List.of(pov,pov));
    Map<String,Object> result=await(service.exportMatch(1,List.of(favorite),"favorites"));assertEquals("completed",result.get("status"),result.toString());assertEquals(1,result.get("viewCount"));assertEquals(1,result.get("missingViews"));assertEquals(1,result.get("povCount"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.exportMatch(1,List.of(),"favorites"));assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.exportMatch(1,List.of(),"invalid"));
  }
  @Test void recordingGuardSkipsReadyPlayersWithoutRequiringDemoButForceDoesNotSilentlySkip() throws Exception {
    Path source=directory.resolve("server/pov-output/1/round-1-test");new ObjectMapper().writeValue(source.resolve("hlae-worker.json").toFile(),Map.of("players",List.of(Map.of("steamid","90000000000000004","name","TestPlayer","slot",9))));
    DemoService real=new DemoService(db);Map<String,Object> task=new HashMap<>(Map.of("matchId",1,"round",1,"startTick",1178,"endTick",6000,"players",List.of(Map.of("steamid","90000000000000004","name","TestPlayer"))));
    assertEquals("completed",real.startPovExport(task).get("status"));
    task.put("force",true);assertThrows(IllegalStateException.class,()->real.startPovExport(task));
  }
  @Test void scopedImportIntoAnExistingFullRecordingDoesNotDuplicateThatPlayer() throws Exception {
    try(Connection c=db.connection();Statement s=c.createStatement()) { s.execute("UPDATE matches SET demo_sha256='"+"b".repeat(64)+"' WHERE id=1"); }
    Path source=directory.resolve("server/pov-output/1/round-1-test");Files.createDirectories(source.resolve("players/player_1"));Files.write(source.resolve("players/player_1/final.mp4"),new byte[]{5,6});
    List<Map<String,Object>> players=List.of(Map.of("steamid","90000000000000004","name","A"),Map.of("steamid","90000000000000002","name","B"));
    when(demos.povExports(1)).thenReturn(List.of(Map.of("output",source.toString(),"round",1,"players",players)));
    Map<String,Object> result=await(service.exportMatch(1,List.of(Map.of("matchId",1,"round",1,"players",List.of(players.get(1)))),"favorites"));
    Map<String,Object> restored=restore(Files.readAllBytes(service.download((String)result.get("jobId"))));assertEquals("completed",restored.get("status"),restored.toString());assertEquals(1L,restored.get("matchId"));
    try(var dirs=Files.list(source.getParent())) { assertEquals(1,dirs.count()); }
  }
  private byte[] rewrite(byte[] archive,boolean invalidReference) throws Exception {
    Map<String,byte[]> entries=new LinkedHashMap<>();
    try(ZipInputStream zip=new ZipInputStream(new java.io.ByteArrayInputStream(archive))) { ZipEntry entry;while((entry=zip.getNextEntry())!=null)entries.put(entry.getName(),zip.readAllBytes()); }
    if(invalidReference) {
      ObjectMapper json=new ObjectMapper();String data=new String(entries.get("data.ndjson"),java.nio.charset.StandardCharsets.UTF_8).replace("\"round_id\":10","\"round_id\":999");byte[] replacement=data.getBytes(java.nio.charset.StandardCharsets.UTF_8);entries.put("data.ndjson",replacement);
      Map<String,Object> manifest=json.readValue(entries.get("manifest.json"),Map.class);
      for(Object raw:(List<?>)manifest.get("files")) { Map<String,Object> file=(Map<String,Object>)raw;if(file.get("path").equals("data.ndjson")) { file.put("size",replacement.length);file.put("sha256",HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(replacement))); } }
      entries.put("manifest.json",json.writeValueAsBytes(manifest));
    } else entries.put("pov/0/final.mp4",new byte[]{9,9,9,9});
    java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();
    try(ZipOutputStream zip=new ZipOutputStream(output)) { for(var entry:entries.entrySet()) { zip.putNextEntry(new ZipEntry(entry.getKey()));zip.write(entry.getValue());zip.closeEntry(); } }
    return output.toByteArray();
  }
}
